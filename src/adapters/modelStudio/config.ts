import "server-only";

/**
 * Model Studio configuration.
 *
 * SERVER ONLY. The `server-only` import at the top is not decoration: if this
 * module is ever pulled into a client component, the build fails rather than
 * shipping a file that reads `process.env.DASHSCOPE_API_KEY` into a browser
 * bundle. A convention would not have caught that; an import error does.
 *
 * Three rules this file enforces:
 *
 * 1. NOT CONFIGURED IS A STATE, NOT AN ERROR. A checkout with no credentials
 *    must run, test and demo. `readModelStudioConfig` returns a NotConfigured
 *    result and the application shows a fixture path, rather than throwing on
 *    import and taking the whole product down.
 *
 * 2. THE KEY IS NEVER RETURNED TO ANYTHING THAT MIGHT DISPLAY IT. The
 *    configuration object carries the key, and `describeConfig` exists so that
 *    logs and screens have something safe to show. Nothing else may format a
 *    config for output.
 *
 * 3. THE WORKSPACE ID IS CONFIGURATION, NOT A CONSTANT. It identifies somebody's
 *    Model Studio workspace, so it is read from the environment and never
 *    written into the repository.
 */

/** The regions Model Studio serves the OpenAI-compatible endpoint from. */
export const MODEL_STUDIO_REGIONS: readonly string[] = [
  "ap-southeast-1",
  "ap-northeast-1",
  "cn-beijing",
  "cn-hongkong",
  "eu-central-1",
];

/** Singapore. The intended region for this build. */
export const DEFAULT_REGION = "ap-southeast-1";

export const DEFAULT_EXTRACTION_MODEL = "qwen3.7-plus";
export const DEFAULT_RESEARCH_MODEL = "qwen3.7-plus";

/**
 * How structured output is requested.
 *
 * Model Studio documents `json_object` for every Qwen model that supports
 * structured output. Its documentation for `json_schema` is inconsistent
 * between pages, so this build defaults to the mode that is unambiguously
 * documented and leaves the stricter one available through configuration rather
 * than guessing. Either way the response is validated by
 * `core/intent/schema.ts`, which is where the guarantee actually comes from: a
 * provider-side schema is a convenience, never the check.
 */
export type StructuredOutputMode = "json_object" | "json_schema";

/**
 * Whether this process may make an external call at all.
 *
 * THE KILL SWITCH, and the reason it exists: a credential is a capability, not
 * an instruction. Before this existed, dropping a key into `.env.local` was
 * enough to make every page render, every form submission and every accidental
 * refresh spend real money on a paid API. Nobody chose that; it happened because
 * "is a key present" was being used to answer "should we call out".
 *
 * Those are different questions and they now have different variables.
 *
 *   disabled  Never touch the network. The default, and the state a fresh
 *             checkout is in. Fixture providers serve every screen.
 *   recorded  Never touch the network. Serve stored artefacts instead.
 *   live      MAY call Model Studio, and only then if credentials are also
 *             present and the operation explicitly asks for it.
 *
 * `live` requires a deliberate act by somebody who knows what it costs. An
 * unset, misspelt or unrecognised value is `disabled`, because the safe reading
 * of an unclear instruction is to do nothing.
 */
export type ModelStudioMode = "disabled" | "recorded" | "live";

export const DEFAULT_MODEL_STUDIO_MODE: ModelStudioMode = "disabled";

const MODES: readonly ModelStudioMode[] = ["disabled", "recorded", "live"];

/**
 * Read the mode, defaulting closed.
 *
 * Deliberately NOT forgiving. A typo in `MODEL_STUDIO_MODE` yields `disabled`
 * rather than a guess, so the failure mode of a configuration mistake is a demo
 * that runs on fixtures rather than a bill.
 */
export function readModelStudioMode(env: EnvSource = process.env): ModelStudioMode {
  const raw = env["MODEL_STUDIO_MODE"];
  if (raw === undefined) return DEFAULT_MODEL_STUDIO_MODE;
  const normalised = raw.trim().toLowerCase();
  return MODES.includes(normalised as ModelStudioMode)
    ? (normalised as ModelStudioMode)
    : DEFAULT_MODEL_STUDIO_MODE;
}

export interface ModelStudioConfig {
  readonly configured: true;
  /** Always "live" here. A configured credential is only reachable in live mode. */
  readonly mode: "live";
  /** Never logged, never displayed, never returned to a client. */
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly region: string;
  readonly workspaceId?: string;
  readonly extractionModel: string;
  readonly researchModel: string;
  readonly structuredOutputMode: StructuredOutputMode;
  readonly timeoutMs: number;
}

export interface ModelStudioNotConfigured {
  readonly configured: false;
  /** The mode that was actually requested, so a screen can say which it is. */
  readonly mode: ModelStudioMode;
  /** Which variables are missing. Names only; never a value. */
  readonly missing: readonly string[];
  /** One sentence safe to show a user. */
  readonly reason: string;
}

export type ModelStudioConfigResult = ModelStudioConfig | ModelStudioNotConfigured;

/** Default deadline for a single call. Overridable, never unbounded. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The environment, as this module needs it.
 *
 * A plain readonly record rather than `NodeJS.ProcessEnv`: the config only ever
 * reads names, and demanding the full process type would force every test to
 * construct one just to check that a missing key is handled.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function readEnv(source: EnvSource, name: string): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Build the workspace-specific base URL.
 *
 * Model Studio serves the OpenAI-compatible endpoints from a per-workspace host
 * in most regions. The workspace id is interpolated only after being checked
 * against a conservative pattern, so a malformed value cannot rewrite the host
 * into somewhere else entirely.
 *
 * An explicit `DASHSCOPE_BASE_URL` always wins. Regions and hostnames change,
 * and a build that can only reach a host it hard-codes is a build that breaks
 * on somebody else's schedule.
 */
export function buildBaseUrl(options: {
  readonly explicitBaseUrl?: string;
  readonly region: string;
  readonly workspaceId?: string;
}): { readonly ok: true; readonly baseUrl: string } | { readonly ok: false; readonly reason: string } {
  if (options.explicitBaseUrl !== undefined) {
    const trimmed = options.explicitBaseUrl.replace(/\/+$/, "");
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?$/i.test(trimmed)) {
      return { ok: false, reason: "DASHSCOPE_BASE_URL is not a valid https URL." };
    }
    return { ok: true, baseUrl: trimmed };
  }

  if (!MODEL_STUDIO_REGIONS.includes(options.region)) {
    return {
      ok: false,
      reason: `MODEL_STUDIO_REGION "${options.region}" is not a region this build knows.`,
    };
  }

  if (options.workspaceId === undefined) {
    return {
      ok: false,
      reason:
        "MODEL_STUDIO_WORKSPACE_ID is required to build the workspace endpoint, or set DASHSCOPE_BASE_URL explicitly.",
    };
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.workspaceId)) {
    return {
      ok: false,
      reason: "MODEL_STUDIO_WORKSPACE_ID contains characters a hostname cannot carry.",
    };
  }

  return {
    ok: true,
    baseUrl: `https://${options.workspaceId}.${options.region}.maas.aliyuncs.com/compatible-mode/v1`,
  };
}

/**
 * Read the configuration from the environment.
 *
 * `env` is a parameter so the whole thing is testable without mutating the
 * process. Reading `process.env` directly inside would make every test either
 * order-dependent or unwritable.
 */
export function readModelStudioConfig(env: EnvSource = process.env): ModelStudioConfigResult {
  const mode = readModelStudioMode(env);

  /**
   * The kill switch, applied before anything else is read.
   *
   * In `disabled` or `recorded` mode this function never returns a configured
   * result, so no caller can obtain a credential, construct a transport or make
   * a request -- whatever else is in the environment. A key sitting in
   * `.env.local` is inert until somebody deliberately sets the mode to `live`.
   *
   * The key is not even read here. There is nothing to leak from a code path
   * that never touches it.
   */
  if (mode !== "live") {
    return {
      configured: false,
      mode,
      missing: [],
      reason:
        mode === "disabled"
          ? "External calls are switched off. Set MODEL_STUDIO_MODE=live to enable them."
          : "Running from stored results. Set MODEL_STUDIO_MODE=live to make real calls.",
    };
  }

  const apiKey = readEnv(env, "DASHSCOPE_API_KEY");
  const missing: string[] = [];
  if (apiKey === undefined) missing.push("DASHSCOPE_API_KEY");

  const region = readEnv(env, "MODEL_STUDIO_REGION") ?? DEFAULT_REGION;
  const workspaceId = readEnv(env, "MODEL_STUDIO_WORKSPACE_ID");
  const explicitBaseUrl = readEnv(env, "DASHSCOPE_BASE_URL");

  const url = buildBaseUrl({
    region,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(explicitBaseUrl === undefined ? {} : { explicitBaseUrl }),
  });

  if (!url.ok) {
    if (workspaceId === undefined && explicitBaseUrl === undefined) {
      missing.push("MODEL_STUDIO_WORKSPACE_ID");
    }
    return {
      configured: false,
      mode,
      missing,
      reason: url.reason,
    };
  }

  if (apiKey === undefined) {
    return {
      configured: false,
      mode,
      missing,
      /**
       * Live was asked for and cannot be delivered. This is NOT a quiet
       * downgrade to fixtures: the caller is told the requested mode failed, and
       * the interface renders a failure rather than a fixture wearing a live
       * label.
       */
      reason: "Live mode is on, but no Model Studio credential is set, so no call can be made.",
    };
  }

  const modeRaw = readEnv(env, "QWEN_STRUCTURED_OUTPUT_MODE");
  const structuredOutputMode: StructuredOutputMode =
    modeRaw === "json_schema" ? "json_schema" : "json_object";

  const timeoutRaw = readEnv(env, "MODEL_STUDIO_TIMEOUT_MS");
  const parsedTimeout = timeoutRaw === undefined ? Number.NaN : Number(timeoutRaw);
  const timeoutMs =
    Number.isInteger(parsedTimeout) && parsedTimeout > 0 && parsedTimeout <= 120_000
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS;

  return {
    configured: true,
    mode: "live",
    apiKey,
    baseUrl: url.baseUrl,
    region,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    extractionModel: readEnv(env, "QWEN_EXTRACTION_MODEL") ?? DEFAULT_EXTRACTION_MODEL,
    researchModel: readEnv(env, "QWEN_RESEARCH_MODEL") ?? DEFAULT_RESEARCH_MODEL,
    structuredOutputMode,
    timeoutMs,
  };
}

/**
 * A description safe to log or display.
 *
 * The only function permitted to turn a config into text. It carries no key, no
 * key length and no key prefix: "sk-abc..." is still four characters of a
 * secret, and a key length is a useful thing to know if you are guessing one.
 */
export function describeConfig(config: ModelStudioConfigResult): Record<string, string> {
  if (!config.configured) {
    return {
      status: "NOT_CONFIGURED",
      mode: config.mode,
      missing: config.missing.join(", "),
      reason: config.reason,
    };
  }
  return {
    status: "CONFIGURED",
    mode: config.mode,
    region: config.region,
    // The host, not the workspace id, and only the part that is not a secret.
    endpointHost: new URL(config.baseUrl).host.replace(/^[^.]+\./, "<workspace>."),
    extractionModel: config.extractionModel,
    researchModel: config.researchModel,
    structuredOutputMode: config.structuredOutputMode,
    timeoutMs: String(config.timeoutMs),
  };
}
