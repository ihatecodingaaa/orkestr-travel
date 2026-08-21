import type { SubsystemStatus } from "../view/provenance";
import { MIXED_PROVENANCE_NOTE } from "../view/provenance";

/**
 * The subsystem status board.
 *
 * This replaces the single Phase 5 fixture banner. The reason is not cosmetic:
 * from Phase 6 the parts of this product have DIFFERENT provenance, and one
 * banner covering all of them would be false about whichever part the reader is
 * about to trust.
 *
 * Every row is always shown, including the ones that say LOCAL FIXTURE and NOT
 * CONNECTED. Hiding the unflattering rows when something goes live is exactly
 * how a demo starts overstating itself, so there is no filtering here at all.
 */
export function SubsystemStatusBoard({
  rows,
  compact = false,
}: {
  readonly rows: readonly SubsystemStatus[];
  readonly compact?: boolean;
}) {
  return (
    <section className="provenance" aria-label="Where this page's information comes from">
      <p className="eyebrow">Where this comes from</p>
      {!compact && <p className="faint">{MIXED_PROVENANCE_NOTE}</p>}
      <ul className="provenance-rows">
        {rows.map((row) => (
          <li key={row.subsystem} className="provenance-row">
            <span className="provenance-name">{row.subsystem}</span>
            <span className={`badge badge-${row.tone}`} title={row.detail}>
              {row.label}
            </span>
            {!compact && <span className="faint provenance-detail">{row.detail}</span>}
            {compact && <span className="sr-only">{row.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
