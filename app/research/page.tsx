import Link from "next/link";
import { connection } from "next/server";
import { runResearchAction } from "./actions";
import { IDLE_RESEARCH } from "./state";
import { ResearchForm } from "./ResearchForm";
import { resolveProviders } from "@/adapters/registry";

/**
 * The research screen.
 *
 * The demo it exists for: a multigenerational Tokyo activity for a group of
 * seven with a stated step-free requirement, at a balanced pace.
 *
 * What a viewer should be able to check without trusting anybody: which pages
 * were actually retrieved, what kind of source each one is, which claims those
 * sources support, where the sources disagree, which citations were rejected as
 * invented, and what is still unknown. If any of that is missing, the screen is
 * not doing its job.
 */
export default async function ResearchPage() {
  // Whether research is live is a runtime fact, not a build-time one. See the
  // note in app/understand/page.tsx.
  await connection();
  const providers = resolveProviders();

  return (
    <main className="shell stack gap-3" style={{ paddingTop: "2rem" }}>
      <header className="stack gap-1">
        <p className="eyebrow">
          <Link href="/">Orkestr Travel</Link> / Research
        </p>
        <h1>Evidence, not opinions</h1>
        <p className="lede">
          Orkestr researches one bounded question at a time, keeps the real source list, and says
          plainly what each kind of source is allowed to establish. A review can tell you what a
          visit felt like. It cannot tell you a lift exists.
        </p>
      </header>

      <ResearchForm
        action={runResearchAction}
        initialState={{ ...IDLE_RESEARCH, mode: providers.research.mode }}
      />

      <section className="card stack gap-1">
        <h2>The rule this screen exists to enforce</h2>
        <p>
          Community evidence may describe experience. It may never establish an operational fact.
          Nine posts saying &ldquo;step-free, no problem&rdquo; are nine people&rsquo;s
          experience, and they are worth reading. They are not a statement from the operator, so
          an access claim with no official source behind it is shown as what people said and
          marked as needing confirmation.
        </p>
        <p className="faint">
          No TikTok, Instagram or Reddit API is used anywhere in this build, and nothing is
          scraped. Community material reaches Orkestr through public web search or through a
          public link somebody chose to share. See <code>docs/SOCIAL_RESEARCH.md</code>.
        </p>
      </section>
    </main>
  );
}
