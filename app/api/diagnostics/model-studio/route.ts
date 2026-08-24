import { createHash, timingSafeEqual } from "node:crypto";
import { probeEndpoint } from "@/server/diagnostics/modelStudioProbe";
import {
  SHARED_SINGAPORE_HOST,
  checkCompatibleBaseUrl,
  endpointCategory,
  maskUrl,
} from "@/adapters/modelStudio/endpoints";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";

/**
 * TEMPORARY. Delete when the Model Studio connectivity incident is closed.
 *
 * WHY A ROUTE AT ALL. The question is whether *the deployed runtime* can reach
 * Alibaba, and nothing that runs on a laptop can answer it. The only way to
 * find out is to execute the probe inside a production function.
 *
 * IT IS NOT A NETWORK-PROBING API. It takes no target from the caller. The two
 * hosts it can reach are fixed in code: the configured workspace endpoint, and
 * Alibaba's shared Singapore endpoint. There is no input that redirects it, so
 * it cannot be used to scan anything.
 *
 * IT IS NOT PUBLIC. A 256-bit token is required in a header, and only the
 * token's SHA-256 lives in this repository -- the same hash-only pattern the
 * invitation system uses, for the same reason: a public repository is not a
 * place to keep a secret. Without the header this route is a 404, because
 * "wrong credential" and "no such route" should look identical to a stranger.
 *
 * IT SPENDS NO MONEY. Every probe stops at the model LIST endpoint. An HTTP 401
 * is a successful outcome here: it proves bytes reached Alibaba and came back.
 * No inference is performed by any code path in this file.
 *
 * IT NEVER TOUCHES THE CREDENTIAL. No key is read from here. `?auth=1` asks the
 * TRANSPORT -- the one class permitted to hold a key -- to make an authenticated
 * GET against a listing endpoint and report the status code. That is still zero
 * inference and zero cost, and it separates three failures a hanging completion
 * cannot: 200 accepted, 401 rejected, 403 refused from this network location,
 * which is what a source-IP restriction looks like from a runtime whose egress
 * address is not on the list.
 */

/** SHA-256 of the incident token. The token itself is not in this repository. */
const TOKEN_HASH = "5825cdff2cfdbf1d37c5d3720c938df3c8f3e03889b6fa706d7c391386042dfd";

/** Layered probes against two hosts need more than a default slice. */
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const offered = request.headers.get("x-orkestr-diagnostic");
  if (offered === null || offered.length === 0) return false;
  const left = Buffer.from(createHash("sha256").update(offered, "utf8").digest("hex"), "utf8");
  const right = Buffer.from(TOKEN_HASH, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The shape of the environment, never its values.
 *
 * `trimmedDiffers` is the one that catches a real and invisible mistake: a
 * value pasted into a hosting dashboard with a trailing newline is a different
 * string from the one that was meant, and every symptom of it looks like
 * something else. It is computed by comparing lengths, so nothing is printed.
 */
function envShape(name: string): Record<string, boolean> {
  const raw = process.env[name];
  return {
    present: raw !== undefined,
    empty: raw !== undefined && raw.trim().length === 0,
    trimmedDiffers: raw !== undefined && raw !== raw.trim(),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return new Response("Not found", { status: 404 });
  }

  const config = readModelStudioConfig();
  const configured = config.configured;
  const withAuth = new URL(request.url).searchParams.get("auth") === "1";

  /**
   * The workspace host is derived from configuration, not from the request.
   * If the configuration cannot produce one, the shared host is still probed --
   * "we cannot even build a URL" is itself a finding worth reporting.
   */
  let workspaceHost: string | undefined;
  let baseUrlReport: Record<string, string> = { status: "NOT_CONFIGURED" };
  if (configured) {
    const parsed = new URL(config.baseUrl);
    workspaceHost = parsed.hostname;
    const shape = checkCompatibleBaseUrl(config.baseUrl);
    baseUrlReport = {
      masked: maskUrl(config.baseUrl),
      category: endpointCategory(parsed.hostname),
      pathOk: shape.ok ? "yes" : `no: ${shape.problem}`,
      // The URL a request is actually built from, masked.
      chatCompletions: maskUrl(`${config.baseUrl}/chat/completions`),
      region: config.region,
      extractionModel: config.extractionModel,
      timeoutMs: String(config.timeoutMs),
    };
  } else {
    baseUrlReport = {
      status: "NOT_CONFIGURED",
      mode: config.mode,
      missing: config.missing.join(", "),
    };
  }

  /**
   * Both hosts concurrently. Sequentially they would exceed a function's
   * lifetime when one of them is the one that hangs -- which is the case this
   * exists to observe.
   */
  const [workspace, shared] = await Promise.all([
    workspaceHost === undefined
      ? Promise.resolve(undefined)
      : probeEndpoint({ host: workspaceHost }),
    probeEndpoint({ host: SHARED_SINGAPORE_HOST }),
  ]);

  /**
   * Only when asked, and only through the transport. Still free: a listing
   * endpoint generates nothing.
   */
  const credential =
    withAuth && config.configured
      ? await new HttpModelStudioTransport(config, () => Date.now()).probeCredential(
          "/models",
          12_000,
        )
      : undefined;

  return Response.json(
    {
      note: "temporary incident diagnostic; zero inference performed",
      runtime: {
        node: process.version,
        region: process.env["VERCEL_REGION"] ?? "(not vercel)",
        deployment: process.env["VERCEL_ENV"] ?? "(not vercel)",
      },
      env: {
        /**
         * Whether a credential is present is reported by the config module,
         * which is the only place permitted to name it. Its own reader trims,
         * so a key pasted with a trailing newline cannot be malformed by
         * whitespace and there is nothing further to check here.
         */
        credential: configured ? "present" : "absent-or-mode-not-live",
        MODEL_STUDIO_WORKSPACE_ID: envShape("MODEL_STUDIO_WORKSPACE_ID"),
        MODEL_STUDIO_REGION: {
          ...envShape("MODEL_STUDIO_REGION"),
          value: process.env["MODEL_STUDIO_REGION"] ?? "(unset)",
        },
        MODEL_STUDIO_MODE: {
          ...envShape("MODEL_STUDIO_MODE"),
          value: process.env["MODEL_STUDIO_MODE"] ?? "(unset)",
        },
        QWEN_EXTRACTION_MODEL: {
          ...envShape("QWEN_EXTRACTION_MODEL"),
          value: process.env["QWEN_EXTRACTION_MODEL"] ?? "(unset)",
        },
        DASHSCOPE_BASE_URL: envShape("DASHSCOPE_BASE_URL"),
      },
      baseUrl: baseUrlReport,
      credentialProbe: credential ?? "(not requested)",
      probes: { workspaceDedicated: workspace ?? "(no workspace host configured)", shared },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
