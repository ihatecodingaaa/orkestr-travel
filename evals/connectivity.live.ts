import { describe, it, expect } from "vitest";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import {
  SHARED_SINGAPORE_HOST,
  checkCompatibleBaseUrl,
  maskUrl,
} from "@/adapters/modelStudio/endpoints";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { probeEndpoint, type EndpointProbe } from "@/server/diagnostics/modelStudioProbe";
import { loadLocalEnv, report } from "./harness";

/**
 * Can this runtime reach Model Studio, layer by layer?
 *
 *   npm run connectivity:model-studio
 *
 * ZERO INFERENCE, SO IT COSTS NOTHING and may be run as often as needed. It
 * stops at the model LIST endpoint; an HTTP 401 is a pass, because the question
 * is whether bytes reach Alibaba and come back, not whether we are allowed in.
 *
 * WHY IT EXISTS. Model Studio answers a laptop in ~9.4s and returned no
 * response headers at all to the deployed runtime before a 30s abort. "It timed
 * out" cannot separate DNS, TCP, TLS, and a slow model, and those have opposite
 * fixes. Run locally this is the CONTROL: it establishes what a working path
 * looks like, so the same probe run in production has something to be compared
 * against.
 *
 * BOTH SINGAPORE HOSTS. The dedicated workspace host is the recommended
 * production endpoint; the shared host is the control that separates "this
 * runtime cannot reach Alibaba" from "this runtime cannot reach that host".
 *
 * PRINTS NO SECRET. Hostnames are masked, the key is never passed to the
 * connectivity layers, and no response body is read into the output.
 */

loadLocalEnv();

const config = readModelStudioConfig();

function line(label: string, probe: EndpointProbe): void {
  const f = (outcome: { ok: boolean; ms: number; code?: string } | undefined): string =>
    outcome === undefined
      ? "n/a"
      : `${outcome.ok ? "OK" : (outcome.code ?? "FAIL")} in ${String(outcome.ms)}ms`;
  report(label, {
    host: probe.host,
    dns: `${f(probe.dns)}  A=${String(probe.dns.ipv4)} AAAA=${String(probe.dns.ipv6)} selected=IPv${String(probe.dns.selectedFamily ?? 0)}`,
    tcp4: f(probe.tcp4),
    tcp6: f(probe.tcp6),
    tls: `${f(probe.tls)}  ${probe.tls.detail ?? ""}`,
    http: probe.http.ok
      ? `HTTP ${String(probe.http.status)} in ${String(probe.http.ms)}ms (headers at ${String(probe.http.headersAtMs)}ms)`
      : f(probe.http),
    verdict: probe.verdict,
  });
}

describe("Model Studio connectivity", () => {
  it("reports the configured endpoint shape without disclosing it", () => {
    if (!config.configured) {
      report("endpoint", { status: "NOT CONFIGURED", hint: "set MODEL_STUDIO_MODE=live" });
      return;
    }
    const shape = checkCompatibleBaseUrl(config.baseUrl);
    report("endpoint", {
      baseUrl: maskUrl(config.baseUrl),
      request: maskUrl(`${config.baseUrl}/chat/completions`),
      path: shape.ok ? "correct" : `WRONG — ${shape.problem}`,
      timeoutMs: config.timeoutMs,
    });
    expect(shape.ok).toBe(true);
  });

  it("probes the shared Singapore host", { timeout: 60_000 }, async () => {
    const probe = await probeEndpoint({ host: SHARED_SINGAPORE_HOST });
    line("shared-dashscope", probe);
    expect(probe.dns.ok).toBe(true);
  });

  it("probes the workspace-dedicated host", { timeout: 60_000 }, async () => {
    if (!config.configured) {
      report("workspace-dedicated", { status: "skipped — no workspace host configured" });
      return;
    }
    const probe = await probeEndpoint({ host: new URL(config.baseUrl).hostname });
    line("workspace-dedicated", probe);
    expect(probe.dns.ok).toBe(true);
  });

  /**
   * Is the credential accepted from HERE?
   *
   * FREE: a listing request generates nothing. It is the check that separates
   * three failures a hanging completion cannot -- 200 accepted, 401 refused,
   * and 403, which is what an API-key source-IP restriction looks like from a
   * runtime whose egress address is not on the allowlist.
   */
  it("asks whether the credential is accepted", { timeout: 30_000 }, async () => {
    if (!config.configured) {
      report("credential", { status: "skipped — not configured" });
      return;
    }
    const transport = new HttpModelStudioTransport(config, () => Date.now());
    const probe = await transport.probeCredential("/models", 12_000);
    report("credential", {
      status: probe.status ?? -1,
      meaning:
        probe.status === 200
          ? "accepted from this network location"
          : probe.status === 401
            ? "REFUSED — key wrong, revoked, or for another region"
            : probe.status === 403
              ? "FORBIDDEN — consistent with a source-IP restriction"
              : `no status (${probe.code ?? "unknown"})`,
      headersAtMs: probe.headersAtMs ?? -1,
      durationMs: probe.durationMs,
    });
    expect(probe.status).toBeDefined();
  });
});
