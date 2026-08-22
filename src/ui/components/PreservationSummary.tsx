import type { PreservationModel, ChangeRowModel } from "../view/repair";

/**
 * What survived a change.
 *
 * COUNTS LEAD, the percentage supports. "100% preserved" on its own reads as
 * "nothing happened", which is a different and usually false claim; the caveat
 * says so explicitly rather than leaving the reader to work it out.
 */
export function PreservationSummary({ model }: { readonly model: PreservationModel }) {
  return (
    <div className="preservation stack gap-2">
      <div className="row" style={{ alignItems: "baseline", gap: "1rem" }}>
        <div className="stack gap-1" style={{ flex: 1, minWidth: "16rem" }}>
          <p className="preservation-primary">{model.primarySentence}</p>
          {model.addedSentence !== undefined && <p className="muted">{model.addedSentence}</p>}
        </div>
        {/* Secondary visual support only, never the headline. */}
        <p className="preservation-pct" aria-hidden="true">
          {model.percent}%
        </p>
      </div>
      <p className="faint">{model.caveat}</p>
    </div>
  );
}

const STATE_WORDING: Record<ChangeRowModel["state"], string> = {
  UNCHANGED: "Unchanged",
  CHANGED: "Changed",
  ADDED: "Added",
  NEEDS_REVERIFICATION: "Needs re-checking",
};

/** A compact diff of what moved and what did not. Never a raw object diff. */
export function ChangeList({ rows }: { readonly rows: readonly ChangeRowModel[] }) {
  return (
    <div className="card stack" aria-label="What changed">
      <h3>What changed</h3>
      {rows.map((row, index) => (
        <div className="change" key={index}>
          <span className={`state-chip state-chip-${row.state}`}>{STATE_WORDING[row.state]}</span>
          <div>
            <strong>{row.label}</strong>
            {row.detail !== undefined && <p className="faint">{row.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
