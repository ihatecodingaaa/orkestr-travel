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
 * TWO RULES.
 *
 * 1. EXTERNAL CALLS ARE OFF BY DEFAULT. Selection is driven by
 *    `MODEL_STUDIO_MODE`, not by whether a credential happens to exist. A key in
 *    `.env.local` is a capability, not an instruction, and using its presence to
 *    decide whether to spend money meant an accidental form submission on a
 *    fresh checkout could do so. See `readModelStudioMode`.
 *
 * 2. THERE IS NO SILENT FALLBACK. What must never happen is a live call failing
 *    and a fixture answer appearing in its place under a live label, because at
 *    that point the label is a lie and nobody watching can tell. When live is
 *    requested and cannot be delivered, the interface renders a failure.
 *
 * This module returns a provider AND the mode it is in, together, from one
 * place, so a screen cannot pick up the provider without also picking up what to
 * call it.
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
      /**
       * LOCAL_FIXTURE, not RECORDED_WEB.
       *
       * An earlier version labelled this RECORDED_WEB, which the interface
       * renders as "Recorded Model Studio result". Nothing has ever been
       * recorded from Model Studio: this data was written by hand in this
       * repository, and calling it a recording of a service that has never been
       * called is exactly the kind of small overclaim that makes a demo
       * untrustworthy under questioning.
       *
       * RECORDED_WEB stays in the model as a declared future state. It becomes
       * reachable when a genuine call has been made and sanitised, and not
       * before. See docs/PROVIDER_MODES.md.
       */
      research: new FixtureResearchProvider("LOCAL_FIXTURE"),
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
