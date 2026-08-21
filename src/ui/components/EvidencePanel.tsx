import type {
  ClaimModel,
  ResearchFailureModel,
  ResearchSpendModel,
  SharedLinkModel,
  SourceModel,
  SuggestionModel,
} from "../view/research";

/**
 * Evidence, sources and suggestions.
 *
 * The judge test for this screen: can somebody who does not trust us check the
 * work? So every claim carries its sources, every source says what kind of
 * source it is and when it was retrieved, and a disagreement is rendered as a
 * disagreement with both statements visible.
 *
 * What is deliberately absent: any raw extracted page text, and any number
 * pretending to be a confidence score.
 */

export function SourceList({ sources }: { readonly sources: readonly SourceModel[] }) {
  if (sources.length === 0) {
    return <p className="faint">No source was recorded for this.</p>;
  }
  return (
    <ul className="source-list">
      {sources.map((source) => (
        <li key={source.url} className="source-item">
          <span className={`badge badge-${source.tone}`} title={source.authorityExplanation}>
            {source.authorityLabel}
          </span>
          {source.linkable ? (
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title}
            </a>
          ) : (
            <span>{source.title}</span>
          )}
          <span className="faint">
            {source.host} &middot; {source.originLabel} &middot; retrieved {source.retrievedAt.slice(0, 10)}
            {source.publishedAt === undefined ? "" : ` · published ${source.publishedAt}`} &middot;{" "}
            {source.freshnessLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ClaimList({ claims }: { readonly claims: readonly ClaimModel[] }) {
  return (
    <ul className="stack gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {claims.map((claim, index) => (
        <li key={String(index)} className="claim">
          <p className="claim-statement">{claim.statement}</p>
          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            <span className="chip">{claim.kindLabel}</span>
            <span className={`badge badge-${claim.tone}`} title={claim.stateExplanation}>
              {claim.stateLabel}
            </span>
            {claim.needsConfirmation && (
              <span
                className="badge badge-pending"
                title="Somebody or some provider has to confirm this before it can be relied on."
              >
                Needs confirmation
              </span>
            )}
          </div>
          {claim.conflictsWith.length > 0 && (
            <div className="conflict">
              <strong>Sources disagree.</strong>
              <ul>
                {claim.conflictsWith.map((other) => (
                  <li key={other}>{other}</li>
                ))}
              </ul>
              <p className="faint">
                Both readings are kept. Orkestr has not picked one, and this cannot be relied on
                until somebody checks.
              </p>
            </div>
          )}
          <SourceList sources={claim.sources} />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Why Orkestr suggested this."
 *
 * Every line is either traced to a source or to a named deterministic check.
 * There is no third kind of reason, so this list cannot contain a sentence
 * nobody can check.
 */
export function SuggestionCard({ model }: { readonly model: SuggestionModel }) {
  return (
    <article className="card stack gap-2">
      <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{model.title}</h3>
        <span
          className="badge badge-neutral"
          title="Orkestr proposes this. Nothing is reserved and nobody has agreed."
        >
          {model.statusLabel}
        </span>
      </div>
      <p>{model.what}</p>
      <p className="faint">
        {model.candidateSlot} &middot; for {model.travellerNames.length} of the group
      </p>

      <div className="stack gap-1">
        <p className="eyebrow">Why Orkestr suggested this</p>
        <ul className="reasons">
          {model.reasons.map((reason, index) => (
            <li key={String(index)}>
              <span>{reason.text}</span> <span className="chip">{reason.basisLabel}</span>
            </li>
          ))}
        </ul>
      </div>

      {model.unknowns.length > 0 && (
        <div className="stack gap-1">
          <p className="eyebrow">Still unknown</p>
          <ul className="unknowns">
            {model.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </div>
      )}

      {model.confirmationsNeeded.length > 0 && (
        <div className="stack gap-1">
          <p className="eyebrow">Somebody needs to check</p>
          <ul className="unknowns">
            {model.confirmationsNeeded.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function ResearchFailure({ model }: { readonly model: ResearchFailureModel }) {
  return (
    <section className="card stack gap-1" role="status">
      <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
        <span className={`badge badge-${model.tone}`}>Research</span>
        <h3 style={{ margin: 0 }}>{model.title}</h3>
      </div>
      <p>{model.detail}</p>
    </section>
  );
}

/** What the run cost. Real counts from the provider, never an estimate. */
export function ResearchSpend({ model }: { readonly model: ResearchSpendModel }) {
  return (
    <div className="card stack gap-1">
      <p className="eyebrow">What this run actually did</p>
      <p className="faint">{model.lines.join(" · ")}</p>
      {model.limitReached && (
        <p className="badge badge-pending" style={{ alignSelf: "flex-start" }}>
          Research limit reached - this is partial, not a complete answer
        </p>
      )}
    </div>
  );
}

export function SharedLinkCard({ model }: { readonly model: SharedLinkModel }) {
  return (
    <li className="shared-link">
      <div className="row" style={{ gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <span className={`badge badge-${model.tone}`} title={model.detail}>
          {model.stateLabel}
        </span>
        {model.platform !== undefined && <span className="chip">{model.platform}</span>}
        {model.linkable ? (
          <a href={model.url} target="_blank" rel="noreferrer noopener">
            {model.url}
          </a>
        ) : (
          <code className="faint">{model.url}</code>
        )}
      </div>
      <p className="faint">{model.detail}</p>
      {model.userNote !== undefined && (
        <blockquote className="source-quote">{model.userNote}</blockquote>
      )}
      {model.askWhySaved && (
        <p className="faint">
          <strong>Why did you save it?</strong> Your own sentence is better evidence of what you
          want than anything we could have guessed from the page.
        </p>
      )}
    </li>
  );
}
