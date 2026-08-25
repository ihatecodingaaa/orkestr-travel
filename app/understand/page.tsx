import Link from "next/link";
import { connection } from "next/server";
import { extractIntentAction } from "./actions";
import { IDLE_UNDERSTANDING } from "./state";
import { UnderstandForm } from "./UnderstandForm";
import { resolveProviders } from "@/adapters/registry";
import { FIXTURE_DISCUSSION } from "@/adapters/fixture/extractionFixtures";

/**
 * The platform ceiling for the server action on this page.
 *
 * Extraction is allowed 50s (see DEFAULT_TIMEOUT_MS, set from measurement).
 * The function it runs inside must outlive that, or the platform kills the
 * request before our own deadline can fire -- and the person is shown a
 * platform error page instead of the honest sentence the product wrote for
 * exactly this case. The two numbers are related and have to move together.
 */
export const maxDuration = 60;

/**
 * The understanding screen.
 *
 * Phase 5 shipped this box DISABLED, because nothing parsed language and a box
 * that silently ignored what somebody typed would have been the first dishonest
 * thing in the product. Phase 6 enables it, and the same standard applies: the
 * screen says which provider read the text, and when no provider is configured
 * it says the reading is a recorded demo rather than a reading of what you typed.
 *
 * WHY THIS IS A SEPARATE ROUTE FROM /demo, and stays separate until Phase 8:
 * there is no persistence. A live extraction produces real proposed travellers
 * and real proposed constraints, and there is nowhere to keep them. Wiring them
 * into the hero trip would mean inventing a session store, which would be fake
 * persistence pretending to be real state. The honest arrangement is two clearly
 * separated things: a live extraction you can run and check, and a deterministic
 * fixture-backed trip. See docs/ARCHITECTURE.md.
 */
export default async function UnderstandPage() {
  /**
   * Stop prerendering here.
   *
   * Whether a model is configured is a RUNTIME fact. Without this the page
   * would be baked at build time and would keep saying "not configured" after
   * somebody added a credential, or worse, keep saying "live" after one was
   * removed. A provenance label that is stale is a provenance label that lies.
   */
  await connection();

  // Read on the server only, to decide what the page says about itself. The
  // config object never crosses to the client.
  const providers = resolveProviders();

  return (
    <main className="shell stack gap-3" style={{ paddingTop: "2rem" }}>
      <header className="stack gap-1">
        <p className="eyebrow">
          <Link href="/">Orkestr Travel</Link> / Understanding
        </p>
        <h1>Turn a group chat into a plan</h1>
        <p className="lede">
          Paste what your group actually said. Orkestr reads it into structured requirements,
          shows you the words behind every one of them, and asks about the few things that
          would change the plan.
        </p>
      </header>

      <UnderstandForm
        action={extractIntentAction}
        initialState={{ ...IDLE_UNDERSTANDING, mode: providers.understanding.mode }}
        sampleDiscussion={FIXTURE_DISCUSSION}
      />

      <section className="card stack gap-1">
        <h2>What this screen does not do</h2>
        <ul className="stack gap-1" style={{ margin: 0, paddingLeft: "1.1rem" }}>
          <li>
            It does not confirm anything. A model may propose a requirement; only the person it
            belongs to can make it binding.
          </li>
          <li>
            It does not decide whether anything is possible. Budgets, times and travel groups
            are compared by deterministic code, not by a model.
          </li>
          <li>
            It does not carry into a trip yet. Nothing read here is saved, and a store that
            pretended otherwise would be worse than the gap.{" "}
            <Link href="/demo">The worked example</Link> stays separate, and always reads the same.
          </li>
        </ul>
      </section>
    </main>
  );
}
