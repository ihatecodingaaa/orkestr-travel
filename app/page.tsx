import Link from "next/link";
import { FixtureBanner } from "@/ui/components/FixtureBanner";

/**
 * Home.
 *
 * The free-text box is deliberately DISABLED and labelled as such. Nothing here
 * parses language yet, and a box that silently ignores what somebody types
 * while implying it was understood would be the first dishonest thing in the
 * product. The demo loader says plainly that it loads fixture data.
 */
export default function HomePage() {
  return (
    <>
      <FixtureBanner />
      <main className="shell">
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
            <span className="faint">
              Loads a fictional seven-person family and local fixture flights. Nothing is booked.
            </span>
          </div>
        </section>

        <section className="split gap-4">
          <div className="card stack gap-2">
            <h2>Tell it what matters</h2>
            <label className="eyebrow" htmlFor="intent">
              Trip context
            </label>
            <textarea
              id="intent"
              rows={4}
              disabled
              placeholder="Six of us want five days in Tokyo in late August. Mum needs step-free access and travels with Dad. Two of us can only leave on the Tuesday."
              style={{
                width: "100%",
                font: "inherit",
                padding: "0.75rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line-strong)",
                background: "var(--paper-sunken)",
                color: "var(--ink-faint)",
                resize: "vertical",
              }}
            />
            {/* Labelled accurately rather than hidden. */}
            <p className="faint">
              Reading free text is not built yet. This build uses a structured demo fixture
              instead, so nothing here is being interpreted.
            </p>
          </div>

          <div className="card stack gap-2">
            <h2>What it does</h2>
            <ul className="stack gap-1" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>Works out whether one flight can carry everybody.</li>
              <li>Splits the group into the fewest travel groups that work.</li>
              <li>Keeps people who must travel together on the same flight.</li>
              <li>Says when the whole group can first be in one place.</li>
              <li>Asks only the person whose preference is affected.</li>
              <li>Tells you what still needs a person or an airline.</li>
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
