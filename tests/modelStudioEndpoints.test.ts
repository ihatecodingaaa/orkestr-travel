import { describe, it, expect } from "vitest";
import {
  COMPATIBLE_PATH,
  SHARED_SINGAPORE_BASE_URL,
  SHARED_SINGAPORE_HOST,
  checkCompatibleBaseUrl,
  endpointCategory,
  maskHost,
  maskUrl,
} from "@/adapters/modelStudio/endpoints";
import { buildBaseUrl, readModelStudioConfig } from "@/adapters/modelStudio/config";

/**
 * The workspace id lives in the hostname.
 *
 * Alibaba's dedicated endpoint is `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`,
 * so logging a URL discloses a workspace. During an incident, URLs are exactly
 * what people paste into chat windows and issue trackers.
 */
describe("hostnames are safe to print", () => {
  it("replaces the workspace label rather than truncating it", () => {
    const masked = maskHost("ws-abc123def.ap-southeast-1.maas.aliyuncs.com");
    expect(masked).toBe("<workspace>.ap-southeast-1.maas.aliyuncs.com");
    expect(masked).not.toContain("ws-abc123def");
    // A prefix of a secret is still part of a secret.
    expect(masked).not.toContain("ws-");
  });

  it("leaves a host that carries no workspace alone", () => {
    expect(maskHost(SHARED_SINGAPORE_HOST)).toBe(SHARED_SINGAPORE_HOST);
  });

  it("masks the host but keeps the path, because the path is what is wrong", () => {
    const masked = maskUrl("https://ws-secret.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(masked).not.toContain("ws-secret");
    expect(masked).toContain("/compatible-mode/v1/chat/completions");
  });

  it("does not throw on something that is not a URL", () => {
    expect(maskUrl("not a url")).toBe("(unparseable URL)");
  });
});

describe("endpoint categories", () => {
  it("recognises the two Singapore routes into the same service", () => {
    expect(endpointCategory("ws-1.ap-southeast-1.maas.aliyuncs.com")).toBe("workspace-dedicated");
    expect(endpointCategory(SHARED_SINGAPORE_HOST)).toBe("shared-dashscope");
  });

  it("does not mistake a lookalike host for Alibaba", () => {
    expect(endpointCategory("maas.aliyuncs.com.evil.example")).toBe("other");
    expect(endpointCategory("dashscope-intl.aliyuncs.com.evil.example")).toBe("other");
  });
});

/**
 * Every defect in this class is invisible until a request is sent.
 *
 * A duplicated `/v1`, a missing `/compatible-mode`, a trailing slash that turns
 * into `//chat/completions`, or the DashScope-native path used with
 * compatible-mode bodies all produce a build that looks configured and a call
 * that cannot work.
 */
describe("the base URL a request is built from", () => {
  it("accepts the shape the product actually uses", () => {
    expect(checkCompatibleBaseUrl(SHARED_SINGAPORE_BASE_URL)).toEqual({ ok: true });
    expect(
      checkCompatibleBaseUrl("https://ws-1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"),
    ).toEqual({ ok: true });
  });

  it("rejects a trailing slash, which would produce a doubled separator", () => {
    const result = checkCompatibleBaseUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/");
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicated /v1", () => {
    const result = checkCompatibleBaseUrl("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/v1");
    expect(result.ok).toBe(false);
  });

  it("rejects the DashScope-native path, which does not take compatible-mode bodies", () => {
    const result = checkCompatibleBaseUrl("https://dashscope-intl.aliyuncs.com/api/v1");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toMatch(/native/i);
  });

  it("rejects plain http", () => {
    expect(checkCompatibleBaseUrl("http://dashscope-intl.aliyuncs.com/compatible-mode/v1").ok).toBe(false);
  });

  it("the path the transport appends produces exactly one separator", () => {
    const base = SHARED_SINGAPORE_BASE_URL;
    expect(`${base}/chat/completions`).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(`${base}/chat/completions`).not.toContain("//chat");
    expect(`${base}/chat/completions`.split("/v1").length - 1).toBe(1);
  });
});

/**
 * A value pasted into a hosting dashboard with a trailing newline is a
 * different string from the one that was meant, and every symptom of it looks
 * like something else.
 */
describe("environment values are trimmed before they reach a hostname", () => {
  const base = {
    MODEL_STUDIO_MODE: "live",
    DASHSCOPE_API_KEY: "test-key-value",
    MODEL_STUDIO_REGION: "ap-southeast-1",
  };

  it("a workspace id with a trailing newline still builds the right host", () => {
    const config = readModelStudioConfig({ ...base, MODEL_STUDIO_WORKSPACE_ID: "ws-abc\n" });
    expect(config.configured).toBe(true);
    if (config.configured) {
      expect(new URL(config.baseUrl).hostname).toBe("ws-abc.ap-southeast-1.maas.aliyuncs.com");
      expect(checkCompatibleBaseUrl(config.baseUrl)).toEqual({ ok: true });
    }
  });

  it("a region with surrounding whitespace is still recognised", () => {
    const config = readModelStudioConfig({
      ...base,
      MODEL_STUDIO_REGION: "  ap-southeast-1  ",
      MODEL_STUDIO_WORKSPACE_ID: "ws-abc",
    });
    expect(config.configured).toBe(true);
  });

  it("a whitespace-only workspace id is missing, not a host called nothing", () => {
    const config = readModelStudioConfig({ ...base, MODEL_STUDIO_WORKSPACE_ID: "   " });
    expect(config.configured).toBe(false);
    if (!config.configured) expect(config.missing).toContain("MODEL_STUDIO_WORKSPACE_ID");
  });

  it("a workspace id that could rewrite the host is refused", () => {
    const result = buildBaseUrl({ region: "ap-southeast-1", workspaceId: "evil.example.com/x" });
    expect(result.ok).toBe(false);
  });

  /**
   * The shared Singapore endpoint is reachable through the EXISTING override.
   * This is why the incident needs no new environment variable: selecting the
   * documented fallback is configuration the build already understands.
   */
  it("the shared Singapore endpoint is selectable without a new variable", () => {
    const config = readModelStudioConfig({
      ...base,
      MODEL_STUDIO_WORKSPACE_ID: "ws-abc",
      DASHSCOPE_BASE_URL: SHARED_SINGAPORE_BASE_URL,
    });
    expect(config.configured).toBe(true);
    if (config.configured) {
      expect(config.baseUrl).toBe(SHARED_SINGAPORE_BASE_URL);
      expect(endpointCategory(new URL(config.baseUrl).hostname)).toBe("shared-dashscope");
      expect(checkCompatibleBaseUrl(config.baseUrl)).toEqual({ ok: true });
    }
  });

  it("an explicit base URL with a trailing slash is normalised, not doubled", () => {
    const config = readModelStudioConfig({
      ...base,
      DASHSCOPE_BASE_URL: `${SHARED_SINGAPORE_BASE_URL}/`,
    });
    expect(config.configured).toBe(true);
    if (config.configured) {
      expect(config.baseUrl).toBe(SHARED_SINGAPORE_BASE_URL);
      expect(`${config.baseUrl}/chat/completions`).not.toContain("//chat");
    }
  });
});

describe("the compatible path is one constant", () => {
  it("is what both hosts serve", () => {
    expect(COMPATIBLE_PATH).toBe("/compatible-mode/v1");
    expect(SHARED_SINGAPORE_BASE_URL.endsWith(COMPATIBLE_PATH)).toBe(true);
  });
});
