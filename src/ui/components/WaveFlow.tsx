import type { LegWavesModel } from "../view/waves";

/**
 * The travel waves visual: the signature screen.
 *
 * Legs are rendered GENERICALLY. There is no outbound component and no return
 * component, so a journey with three legs needs no new code and a future
 * multi-city trip needs no new screen.
 *
 * The reunion marker draws two paths rejoining. It is decoration around a real
 * fact (the earliest instant everybody has landed), and the fact is in the text
 * so it survives with images or animation off.
 */
export function WaveFlow({ model }: { readonly model: LegWavesModel }) {
  return (
    <section className="stack gap-3" aria-label={`${model.directionLabel}, ${model.routeLabel}`}>
      <header className="stack gap-1">
        <p className="eyebrow">
          {model.directionLabel} · {model.routeLabel}
        </p>
        <h2>{model.headline}</h2>
        <p className="lede">{model.subheadline}</p>
      </header>

      <div className="waveflow">
        {model.waves.map((wave, index) => (
          <article
            key={wave.id}
            className="wave-card animate-in"
            data-index={index}
            aria-label={`${wave.label}, ${wave.dayLabel}`}
          >
            <div className="wave-title">
              <h3>{wave.label}</h3>
              <span className="muted">{wave.dayLabel}</span>
              <span className="wave-time">
                {wave.departureLabel} → {wave.arrivalLabel}
              </span>
              <span className="faint" style={{ marginLeft: "auto" }}>
                {wave.farePerTraveller} each
              </span>
            </div>

            <div className="avatars">
              {wave.members.map((member) => (
                <span className="avatar" key={member.id}>
                  <i aria-hidden="true">{member.initials}</i>
                  {member.displayName}
                </span>
              ))}
            </div>

            {wave.hasUnresolved && (
              <p className="faint" style={{ marginTop: "0.6rem" }}>
                Something on this flight still needs confirming.
              </p>
            )}
          </article>
        ))}
      </div>

      {model.reunion !== undefined && !model.reunion.isTrivial && (
        <div className="reunion animate-in">
          <div className="reunion-rule" aria-hidden="true" />
          <p className="eyebrow">Everyone together from</p>
          <h3>{model.reunion.whenLabel}</h3>
          <p className="muted">
            All {model.reunion.travellerCount} travellers have landed by this point.
          </p>
          {/* Never invented. The domain does not know where, so neither do we. */}
          <p className="faint">{model.reunion.locationLabel}</p>
        </div>
      )}
    </section>
  );
}

/** The deterministic reasons panel. Nothing here is generated text. */
export function WhyThisWorks({ model }: { readonly model: LegWavesModel }) {
  const satisfied = model.reasons.filter((r) => r.kind === "SATISFIED");
  const open = model.reasons.filter((r) => r.kind === "OPEN");

  return (
    <aside className="card stack gap-2" aria-label="Why this works">
      <h3>Why this works</h3>
      <ul className="stack gap-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {satisfied.map((reason, index) => (
          <li key={index} className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
            <span aria-hidden="true" style={{ color: "var(--tone-verified)" }}>
              ✓
            </span>
            <span>{reason.text}</span>
          </li>
        ))}
      </ul>

      {open.length > 0 && (
        <>
          <h3 style={{ marginTop: "0.4rem" }}>Still open</h3>
          <ul className="stack gap-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {open.map((reason, index) => (
              <li key={index} className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
                <span aria-hidden="true" style={{ color: "var(--tone-pending)" }}>
                  ?
                </span>
                <span>{reason.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="faint">
        Every line here comes from the planning result itself, not from a written summary.
      </p>
    </aside>
  );
}
