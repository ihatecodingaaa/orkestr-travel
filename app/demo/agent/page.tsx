import { buildDemoWorld, buildAgentRun } from "@/ui/demo/scenario";
import { readDemoState, demoHref } from "@/ui/demo/params";
import type { RawParams } from "@/ui/demo/params";
import { DemoChrome } from "@/ui/components/DemoChrome";
import { TruthBadge } from "@/ui/components/TruthBadge";
import {
  auditTrail,
  changeSummary,
  runFacts,
  runHeadline,
  technicalDetail,
} from "@/ui/view/agentRun";
import { RECORDED_AT } from "@/adapters/atlas/recordedSandbox";
import Link from "next/link";

/**
 * What Orkestr did when something changed.
 *
 * The one screen that answers the question a judge actually has: not "can it
 * plan a trip", which everything can, but "when the plan breaks, does it know
 * what to leave alone?"
 *
 * The whole page renders from ONE `AgentRun`, built from the SAME repair the
 * rest of the demo shows. Nothing here recomputes, re-summarises or
 * re-interprets: if this screen could tell a different story from `/demo/waves`,
 * one of them would be narration.
 *
 * Copy rule: no internal vocabulary above the technical drawer. "Impact radius"
 * is how the code thinks; "what this affected" is what a person reads.
 */
export default async function AgentPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawParams>;
}) {
  const state = readDemoState(await searchParams);
  const world = await buildDemoWorld(state);
  const run = buildAgentRun(world, state);

  if (run === undefined) {
    return (
      <DemoChrome state={state} current="agent">
        <section className="stack gap-3" style={{ paddingTop: "2rem" }}>
          <header className="stack gap-1">
            <p className="eyebrow">The agent</p>
            <h1>Nothing has changed yet</h1>
            <p className="lede">
              The plan is agreed and nobody has moved. Orkestr only runs when something actually
              happens — there is no background loop burning through your trip.
            </p>
          </header>
          <p>
            <Link className="btn" href={demoHref("/demo/agent", state, { stage: "RYAN_JOINED" })}>
              Add Ryan to the trip
            </Link>
          </p>
        </section>
      </DemoChrome>
    );
  }

  const headline = runHeadline(run.status, run.termination.reason);
  const facts = runFacts(run);
  const waveLabels = new Map<string, string>(
    (world.outboundPlan?.waves ?? []).map((wave) => [wave.id as string, wave.label]),
  );
  const change = changeSummary(run, waveLabels);
  const trail = auditTrail(run);

  return (
    <DemoChrome state={state} current="agent">
      <section className="stack gap-3" style={{ paddingTop: "2rem" }}>
        <header className="stack gap-1">
          <p className="eyebrow">The agent</p>
          <h1>{headline.title}</h1>
          <p className="lede">{headline.detail}</p>
          <p>
            <TruthBadge
              model={{
                label: run.status.replace(/_/g, " ").toLowerCase(),
                tone: headline.tone,
                explanation: run.termination.reason,
              }}
            />
          </p>
        </header>

        {/* ---------------------------------------------- what changed */}
        <article className="card stack gap-2">
          <h2>What changed</h2>
          <p>{change.whatChanged}</p>

          <div className="stack gap-1">
            <h3 className="faint">What this affected</h3>
            {change.affected.length === 0 ? (
              <p>Nothing. The change did not reach any part of the agreed plan.</p>
            ) : (
              <ul>
                {change.affected.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="stack gap-1">
            {/*
              The half most planners cannot answer at all, because they rebuild
              everything and have nothing left to compare against.
            */}
            <h3 className="faint">What stayed exactly as it was</h3>
            {change.untouched.length === 0 ? (
              <p>Nothing was left untouched by this change.</p>
            ) : (
              <ul>
                {change.untouched.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </div>
        </article>

        {/* ---------------------------------------------- the numbers */}
        <article className="card stack gap-2">
          <h2>What it cost</h2>
          <p className="faint">
            Every figure here is counted, not estimated. There is no money saved claim, because
            nobody could check one.
          </p>
          <dl className="fact-grid">
            {facts.map((fact) => (
              <div key={fact.label} className="fact">
                <dt>{fact.label}</dt>
                <dd>
                  <strong>{fact.value}</strong>
                  {fact.note !== undefined && <span className="faint"> {fact.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        {/* ---------------------------------------------- audit trail */}
        <article className="card stack gap-2">
          <h2>What it did, step by step</h2>
          <ol className="stack gap-1">
            {trail.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="faint">
            The run stops either way at {run.accounting.maxSteps} steps. Running out of steps is
            recorded as running out of steps — never as success.
          </p>
        </article>

        {/* ---------------------------------------------- still unknown */}
        {run.unresolved.length > 0 && (
          <article className="card stack gap-2">
            <h2>Still needs confirming</h2>
            {/*
              Deliberately not hidden once the plan looks tidy. An unknown that
              disappears on the way to a summary is the dangerous kind.
            */}
            <ul>
              {run.unresolved.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        )}

        {/* ---------------------------------------------- provider proof */}
        <article className="card stack gap-2">
          <h2>Where the flight facts came from</h2>
          <p>
            <TruthBadge
              model={{
                label: "Recorded Atlas sandbox",
                tone: "neutral",
                explanation:
                  "A real Atlas Sandbox search and re-check, captured earlier and replayed here.",
              }}
            />
          </p>
          <p>
            Orkestr searched a real flight provider, then <strong>re-checked the fare before
            relying on it</strong>. Sandbox fares are test data: they cannot be bought, and nothing
            here is booked.
          </p>
          <p className="faint">
            HKG → MNL · UO534 · direct · USD 101.29 · searched, then verified · price unchanged ·
            recorded {RECORDED_AT.slice(0, 10)}
          </p>
          <p className="faint">
            The Tokyo trip above is a demo scenario. Atlas Sandbox serves a bounded set of test
            routes and does not carry it, so the provider proof is shown on a route it does serve
            rather than pretending otherwise.
          </p>
        </article>

        {/* ---------------------------------------------- technical drawer */}
        <details className="card">
          <summary>
            <strong>Technical detail</strong>
          </summary>
          <dl className="fact-grid" style={{ marginTop: "1rem" }}>
            {technicalDetail(run).map((fact) => (
              <div key={fact.label} className="fact">
                <dt>{fact.label}</dt>
                <dd>
                  <code>{fact.value}</code>
                  {fact.note !== undefined && <span className="faint"> {fact.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
    </DemoChrome>
  );
}
