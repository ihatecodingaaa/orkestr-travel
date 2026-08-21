/**
 * Reading the Model Studio Responses API output array.
 *
 * SEPARATE FROM THE ADAPTER ON PURPOSE. Extracting real source URLs from
 * provider tool output is the single most important step in the research path:
 * it is what makes a citation checkable rather than decorative. Keeping it in
 * its own pure module means it can be tested exhaustively against recorded
 * response bodies, including the malformed and half-empty ones a live service
 * eventually produces.
 *
 * The documented shape, as of this build:
 *
 *   output: [
 *     { type: "web_search_call",    action: { query, type, sources: [{ type, url }], queries } },
 *     { type: "web_extractor_call", goal, output, urls: [ "https://..." ] },
 *     { type: "message",            content: [{ type: "output_text", text }] },
 *     { type: "reasoning",          summary: [...] }
 *   ]
 *   usage: { input_tokens, output_tokens, x_tools: { web_search: { count } } }
 *
 * Every field is read defensively. A provider that adds an item type, renames a
 * field or returns an empty action must produce fewer sources here, never a
 * crash and never a fabricated one.
 */

export interface ExtractedSourceRef {
  readonly url: string;
  readonly title?: string;
  readonly searchQuery?: string;
  readonly rank?: number;
}

export interface ResponsesReadResult {
  /** URLs the provider's own tools reported. The only URLs that may be trusted. */
  readonly sources: readonly ExtractedSourceRef[];
  /** Assistant message text, concatenated. Expected to hold the JSON payload. */
  readonly text: string;
  readonly searchOperations: number;
  readonly extractionOperations: number;
  /** Pages the extractor was pointed at, whether or not it could read them. */
  readonly extractedUrls: readonly string[];
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Item statuses that were not "completed", e.g. a blocked extraction. */
  readonly failedOperations: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Read one search call.
 *
 * `sources` entries are documented as `{ type: "url", url: "..." }`. A plain
 * string is also accepted because tolerating both costs one line and a provider
 * change that flattened them would otherwise silently produce zero sources,
 * which reads as "we found nothing" rather than "we could not read the reply".
 */
function readSearchCall(
  item: Record<string, unknown>,
  into: ExtractedSourceRef[],
): void {
  const action = isRecord(item["action"]) ? item["action"] : undefined;

  /**
   * The live provider sends BOTH `query` and `queries`.
   *
   * Observed on a real call: `action: {query, type, sources, queries}` where
   * `queries` held the two variants the model actually ran. The documentation
   * described only `query`. Reading both means a source records the query that
   * surfaced it even when the provider stops sending the singular form, and it
   * costs one fallback.
   */
  const queries = action === undefined ? [] : asArray(action["queries"]);
  const firstQuery = queries.map(asString).find((q) => q !== undefined);
  const query = (action === undefined ? undefined : asString(action["query"])) ?? firstQuery;

  const rawSources = action === undefined ? [] : asArray(action["sources"]);

  rawSources.forEach((entry, index) => {
    const url = typeof entry === "string" ? asString(entry) : isRecord(entry) ? asString(entry["url"]) : undefined;
    if (url === undefined) return;
    const title = isRecord(entry) ? asString(entry["title"]) : undefined;
    into.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(query === undefined ? {} : { searchQuery: query }),
      rank: index + 1,
    });
  });
}

/**
 * Read the Responses API body.
 *
 * Returns what was actually there. It never invents a source and never treats
 * text in the assistant message as provenance, which is the whole point.
 */
export function readResponsesBody(body: unknown): ResponsesReadResult {
  const sources: ExtractedSourceRef[] = [];
  const extractedUrls: string[] = [];
  const failedOperations: string[] = [];
  const textParts: string[] = [];
  let searchOperations = 0;
  let extractionOperations = 0;

  if (!isRecord(body)) {
    return {
      sources,
      text: "",
      searchOperations,
      extractionOperations,
      extractedUrls,
      failedOperations: ["The provider response could not be read."],
    };
  }

  for (const raw of asArray(body["output"])) {
    if (!isRecord(raw)) continue;
    const type = asString(raw["type"]);
    const status = asString(raw["status"]);

    if (type === "web_search_call") {
      searchOperations += 1;
      if (status !== undefined && status !== "completed") {
        failedOperations.push(`web_search: ${status}`);
      }
      readSearchCall(raw, sources);
      continue;
    }

    if (type === "web_extractor_call") {
      extractionOperations += 1;
      if (status !== undefined && status !== "completed") {
        failedOperations.push(`web_extractor: ${status}`);
      }
      for (const url of asArray(raw["urls"])) {
        const value = asString(url);
        if (value !== undefined) extractedUrls.push(value);
      }
      continue;
    }

    if (type === "message") {
      for (const part of asArray(raw["content"])) {
        if (!isRecord(part)) continue;
        const text = asString(part["text"]);
        if (text !== undefined) textParts.push(text);
      }
      continue;
    }
    // "reasoning" and anything else are deliberately ignored. A reasoning
    // summary is the model narrating itself; it is not evidence and must never
    // be read as a source.
  }

  const usage = isRecord(body["usage"]) ? body["usage"] : undefined;
  const inputTokens = usage === undefined ? undefined : asNumber(usage["input_tokens"]);
  const outputTokens = usage === undefined ? undefined : asNumber(usage["output_tokens"]);

  return {
    sources,
    text: textParts.join("\n").trim(),
    searchOperations,
    extractionOperations,
    extractedUrls,
    failedOperations,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}
