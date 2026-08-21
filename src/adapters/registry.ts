import "server-only";
import type { LanguageUnderstandingProvider } from "../domain/extraction";
import type { ResearchProvider } from "../domain/research";
import type { ModelStudioConfigResult } from "./modelStudio/config";
import type { ModelStudioTransport } from "./modelStudio/transport";
import { readModelStudioConfig } from "./modelStudio/config";
import type { EnvSource } from "./modelStudio/config";
import { HttpModelStudioTransport } from "./modelStudio/transport";
import { QwenLanguageUnderstandingProvider } from "./modelStudio/qwenLanguageUnderstanding";
import { QwenWebResearchProvider } from "./modelStudio/qwenWebResearch";
import { FixtureLanguageUnderstandingProvider } from "./fixture/fixtureLanguageUnderstanding";
import { FixtureResearchProvider } from "./fixture/fixtureResearch";

/**
 * Provider selection.
 *
 * THE ONE RULE: THERE IS NO SILENT FALLBACK.
 *
 * If Model Studio is configured, the live provider is used and the interface
 * says LIVE. If it is not, the fixture provider is used and the interface says
 * DEMO FIXTURE. What must never happen is a live call failing and a fixture
 * answer appearing in its place under a live label, because at that point the
 * label is a lie and nobody watching can tell.
 *
 * So this module returns a provider AND the mode it is in, together, from one
 * place. A screen cannot pick up the provider without also picking up what to
 * call it.
 *
 * When a live call fails at run time, it fails. It does not become a fixture.
 * The failure states in `docs/FAILURE_MODES.md` exist so that a failure has
 * somewhere honest to land.
 */

export interface ProviderBundle {
  readonly understanding: LanguageUnderstandingProvider;
  readonly research: ResearchProvider;
  readonly config: ModelStudioConfigResult;
  /** Present only when live. Adapters that need their own calls reuse it. */
  readonly transport?: ModelStudioTransport;
}

export interface RegistryOptions {
  readonly env?: EnvSource;
  /** Injected in tests so no clock and no socket is involved. */
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
  /**
   * Force the fixture path even when credentials exist.
   *
   * For rehearsing a demo offline, and for the deterministic test suite. It can
   * only ever move DOWN in confidence: there is deliberately no option that
   * makes fixtures claim to be live.
   */
  readonly forceFixture?: boolean;
}

export function resolveProviders(options: RegistryOptions = {}): ProviderBundle {
  const config = readModelStudioConfig(options.env ?? process.env);

  if (options.forceFixture === true || !config.configured) {
    return {
      understanding: new FixtureLanguageUnderstandingProvider(),
      // Fixture research replays a sanitised structured capture, so it is
      // labelled RECORDED_WEB rather than LOCAL_FIXTURE: the source URLs and
      // titles are real pages, even though no call was made now.
      research: new FixtureResearchProvider("RECORDED_WEB"),
      config,
    };
  }

  const transport = new HttpModelStudioTransport(
    config,
    options.now ?? (() => Date.now()),
    options.fetchImpl ?? fetch,
  );

  return {
    understanding: new QwenLanguageUnderstandingProvider(config, transport),
    research: new QwenWebResearchProvider(config, transport),
    config,
    transport,
  };
}
