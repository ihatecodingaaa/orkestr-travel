import type { UnderstandingModel, UnderstandingFailureModel } from "../view/understanding";

/**
 * "Here's what Orkestr understood."
 *
 * The screen where a machine's reading of somebody's words is put in front of
 * them before any of it counts.
 *
 * Two rules in the markup:
 *
 * 1. EVERY ROW SHOWS ITS QUOTE. Not on hover, not behind a disclosure. If a
 *    person has to work to see the basis of a claim about their own trip, they
 *    will not do it, and the review becomes a rubber stamp.
 *
 * 2. NOTHING SENSITIVE IS PRINTED IN A GROUP CONTEXT. An assistance requirement
 *    renders its category and its owner, never a medical detail, and the review
 *    screen states plainly that the group does not see it.
 */
export function UnderstandingReview({ model }: { readonly model: UnderstandingModel }) {
  return (
    <section className="stack gap-3">
      <header className="stack gap-1">
        <h2>Here is what Orkestr understood</h2>
        <p className="lede">{model.headline}</p>
        {model.confirmationSentence !== undefined && (
          <p className="badge badge-pending" style={{ alignSelf: "flex-start" }}>
            {model.confirmationSentence}
          </p>
        )}
      </header>

      {model.tripContext !== undefined && (
        <div className="card stack gap-1">
          <p className="eyebrow">The trip</p>
          <p>{model.tripContext.summary}</p>
          <span className={`badge badge-${model.tripContext.certainty.tone}`}>
            {model.tripContext.certainty.label}
          </span>
        </div>
      )}

      <div className="card stack gap-2">
        <h3>Who is going</h3>
        <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {model.travellers.map((traveller) => (
            <li key={traveller.ref} className="understood-row">
              <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
                <strong>{traveller.displayName}</strong>
                <span className={`badge badge-${traveller.certainty.tone}`} title={traveller.certainty.explanation}>
                  {traveller.certainty.label}
                </span>
                <span className="faint">
                  {traveller.constraintCount === 0
                    ? "nothing recorded yet"
                    : `${String(traveller.constraintCount)} thing${traveller.constraintCount === 1 ? "" : "s"} recorded`}
                </span>
              </div>
              <blockquote className="source-quote">{traveller.quote}</blockquote>
            </li>
          ))}
        </ul>
      </div>

      {model.constraints.length > 0 && (
        <div className="card stack gap-2">
          <h3>What each person said they need</h3>
          <p className="faint">
            Nothing here is settled. Orkestr read it from the discussion, and anything that
            would change the plan waits for the person it belongs to.
          </p>
          <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {model.constraints.map((constraint, index) => (
              <li key={`${constraint.ownerName}-${String(index)}`} className="understood-row">
                <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
                  <strong>{constraint.ownerName}</strong>
                  <span>{constraint.summary}</span>
                </div>
                <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                  <span className="chip">{constraint.strengthLabel}</span>
                  <span
                    className={`badge badge-${constraint.certainty.tone}`}
                    title={constraint.certainty.explanation}
                  >
                    {constraint.certainty.label}
                  </span>
                  {constraint.needsConfirmation && (
                    <span
                      className="badge badge-pending"
                      title="Its owner must confirm this before it can affect anybody's flights."
                    >
                      Waiting for {constraint.ownerName}
                    </span>
                  )}
                  {constraint.sensitive && (
                    <span
                      className="badge badge-unknown"
                      title="The group is never shown this. Orkestr plans around it without announcing it."
                    >
                      Not shown to the group
                    </span>
                  )}
                </div>
                {constraint.quote.length > 0 && (
                  <blockquote className="source-quote">{constraint.quote}</blockquote>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {model.relationships.length > 0 && (
        <div className="card stack gap-2">
          <h3>Who travels with whom</h3>
          <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {model.relationships.map((relationship, index) => (
              <li key={String(index)} className="understood-row">
                <span>{relationship.summary}</span>
                <blockquote className="source-quote">{relationship.quote}</blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}

      {model.ambiguities.length > 0 && (
        <div className="card stack gap-2">
          <h3>
            {model.ambiguities.length === 1
              ? "One thing Orkestr is not sure about"
              : `${String(model.ambiguities.length)} things Orkestr is not sure about`}
          </h3>
          <p className="faint">
            These are only here because the answer would change the plan. Orkestr does not
            ask about anything that would not.
          </p>
          <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {model.ambiguities.map((ambiguity, index) => (
              <li key={String(index)} className="understood-row">
                <strong>{ambiguity.question}</strong>
                {ambiguity.aboutName !== undefined && (
                  <span className="faint"> Ask {ambiguity.aboutName}.</span>
                )}
                <p className="faint">{ambiguity.whyItMatters}</p>
                <blockquote className="source-quote">{ambiguity.quote}</blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}

      {model.preferences.length > 0 && (
        <div className="card stack gap-2">
          <h3>What the group said it wants</h3>
          <ul className="stack gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {model.preferences.map((preference, index) => (
              <li key={String(index)} className="understood-row">
                <span>
                  <strong>{preference.label}</strong>
                  {preference.ownerName !== undefined && (
                    <span className="faint"> - {preference.ownerName}</span>
                  )}
                </span>
                <blockquote className="source-quote">{preference.quote}</blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The failure panel.
 *
 * Says which failure it was, in a sentence, and says what happened to the data.
 * "Something went wrong" would leave a person guessing whether half their trip
 * had just been rewritten.
 */
export function UnderstandingFailure({ model }: { readonly model: UnderstandingFailureModel }) {
  return (
    <section className="card stack gap-2" role="status">
      <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
        <span className={`badge badge-${model.tone}`}>Extraction failed</span>
        <h2 style={{ margin: 0 }}>{model.title}</h2>
      </div>
      <p>{model.detail}</p>
      <p className="faint">{model.whatHappensNow}</p>
    </section>
  );
}
