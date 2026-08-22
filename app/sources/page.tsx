import Link from "next/link";
import { connection } from "next/server";
import { SubsystemStatusBoard } from "@/ui/components/SubsystemStatusBoard";
import { buildProvenanceBoard } from "@/ui/view/provenance";
import { resolveProviders } from "@/adapters/registry";

/**
 * Sources and verification.
 *
 * This WAS the home page, and leading with it was the mistake this refit
 * corrects: it explained which subsystem was live before a person knew what the
 * product did. Every word of it is still true and still worth having -- so it
 * lives here, one click away, for somebody who wants to check rather than
 * somebody who just arrived.
 *
 * Original note follows.
 *
 * Phase 5 shipped the free-text box DISABLED, because nothing parsed language.
 * Phase 6 connects a language model, so the box now leads somewhere real, and
 * the page says which of the two it is: a live model call, or a recorded demo
 * reading. What it never does is imply the text was understood when it was not.
 *
 * The single Phase 5 banner is replaced by the subsystem board, because the
 * parts of this product now have different provenance and one label covering all
 * of them would be false about whichever part somebody is about to trust.
 */
export default async function SourcesPage() {
  // The board below reports which subsystems are live, which is a runtime fact.
  await connection();
  const providers = resolveProviders();
  const live = providers.understanding.mode === "LIVE_MODEL";

  return (
    <>
      <>
        <section className="hero stack gap-3">
          <p className="eyebrow">Orkestr Travel</p>
          <h1>Plan a trip around everyone.</h1>
          <p className="lede">
            Tell Orkestr who is going, when they can travel and what matters to each of them.
            It works out how the group can actually make the trip happen, and asks the fewest
            people the fewest questions to get there.
          </p>

          <div className="hero-paths" aria-hidden="true" />

          <div className="row">
            <Link className="btn" href="/demo">
              Load the family demo
            </Link>
            <Link className="btn btn-secondary" href="/understand">
              Paste a group chat
            </Link>
            <Link className="btn btn-secondary" href="/research">
              See the evidence layer
            </Link>
          </div>
        </section>

        <SubsystemStatusBoard
          rows={buildProvenanceBoard({
            understanding: providers.understanding.mode,
            research: providers.research.mode,
          })}
        />

        <section className="split gap-4">
          <div className="card stack gap-2">
            <h2>Tell it what matters</h2>
            <p>
              Paste what your group actually said. Orkestr reads it into structured
              requirements, shows the words behind every one of them, and asks only about the
              things where the answer would change the plan.
            </p>
            <p className="faint">
              {live
                ? "This build has a live model configured. What you paste is sent to Alibaba Cloud Model Studio and read there."
                : "This build has no model configured, so the understanding screen replays a recorded demo reading and says so on the page."}
            </p>
            <p className="faint">
              Either way, a model may propose a requirement and never confirm one. Anything that
              would change the plan waits for the person it belongs to.
            </p>
            <Link className="btn btn-small" href="/understand">
              Open the understanding screen
            </Link>
          </div>

          <div className="card stack gap-2">
            <h2>What it does</h2>
            <ul className="stack gap-1" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>Reads a group chat into requirements, each traced to a quote.</li>
              <li>Works out whether one flight can carry everybody.</li>
              <li>Splits the group into the fewest travel groups that work.</li>
              <li>Keeps people who must travel together on the same flight.</li>
              <li>Says when the whole group can first be in one place.</li>
              <li>Researches one bounded question and keeps the real sources.</li>
              <li>Asks only the person whose preference is affected.</li>
              <li>Tells you what still needs a person or an airline.</li>
            </ul>
          </div>
        </section>
      </>
    </>
  );
}
