"use client";

import { useState } from "react";
import type { IdeaCategory } from "@/domain/livingTrip";
import type { TripActions } from "@/ui/trip/actions";
import { readLink, type LinkReadingResult } from "~/trip/[tripId]/explore/actions";

/**
 * Pasting the TikTok your friend sent you.
 *
 * WHAT THIS REPLACES was a text box, a title field, and a sentence admitting
 * that Orkestr would not open the link. The person did the reading and typed the
 * answer in; the product filed it.
 *
 * WHAT IT SAYS IT DID IS WHAT IT DID. A caption is not a video, so the card says
 * "Read the caption on this TikTok". Nothing here can say "watched", because
 * nothing here watches.
 *
 * THE LINK ALWAYS SURVIVES. Whether Orkestr reads a place, reads nothing, or
 * cannot open it at all, "View original" is on the card. A source somebody
 * cannot get back to is worse than one that was never saved.
 */
export function PasteLink({
  destination,
  actions,
  onSaved,
}: {
  readonly destination: string;
  readonly actions: TripActions;
  readonly onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkReadingResult | undefined>(undefined);
  const [saved, setSaved] = useState<readonly string[]>([]);
  const [manual, setManual] = useState("");

  async function analyse(event: React.FormEvent) {
    event.preventDefault();
    if (url.trim().length === 0 || busy) return;
    setBusy(true);
    setResult(undefined);
    setSaved([]);
    try {
      setResult(await readLink({ url: url.trim(), destination }));
    } catch {
      /**
       * The action already turns every expected outcome into a result, so this
       * is the unexpected one. It still has to be a sentence rather than a
       * blank screen.
       */
      setResult(undefined);
      setManual("");
    } finally {
      setBusy(false);
    }
  }

  async function save(name: string, category: IdeaCategory, note?: string) {
    await actions.addIdea({
      title: name,
      category,
      url: result?.source.originalUrl ?? url.trim(),
      ...(note === undefined ? {} : { note }),
    });
    setSaved((current) => [...current, name]);
    onSaved();
  }

  return (
    <div className="stack gap-2">
      <form className="panel stack gap-2" onSubmit={(event) => void analyse(event)}>
        <div className="field">
          <label htmlFor="paste-url">Paste a link</label>
          <input
            id="paste-url"
            className="input input-large"
            inputMode="url"
            autoComplete="off"
            placeholder="A TikTok, a reel, an article…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="faint">
            Orkestr opens public links and reads what they say about themselves. It keeps the
            original either way.
          </p>
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={busy || url.trim().length === 0}>
            {busy ? "Reading the link…" : "See what this is"}
          </button>
        </div>
      </form>

      {/*
        §44. Three honest lines rather than a spinner. They are not ticked off on
        a timer -- they describe the work as a whole, because the server sends no
        progress and animating one would be inventing detail.
      */}
      {busy && (
        <div className="panel stack gap-1" role="status" aria-live="polite">
          <strong>Opening the link…</strong>
          <p className="faint">
            Reading what it says about itself, then working out which place it might be.
          </p>
        </div>
      )}

      {result !== undefined && (
        <div className="panel stack gap-2 source-card">
          <div className="source-head">
            {result.source.thumbnailUrl !== undefined && (
              // eslint-disable-next-line @next/next/no-img-element -- an arbitrary public host, not our own
              <img
                className="source-thumb"
                src={result.source.thumbnailUrl}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            )}
            <div className="stack gap-1">
              <span className="tag">{providerWords(result.source.provider)}</span>
              {result.source.title !== undefined && <strong>{result.source.title}</strong>}
              {result.source.author !== undefined && (
                <span className="faint">{result.source.author}</span>
              )}
              <span className="faint">{result.statusWords}</span>
            </div>
          </div>

          <p className="faint source-evidence">{result.evidenceWords}</p>

          {result.candidates.length > 0 && (
            <div className="stack gap-1">
              <p className="eyebrow">
                {result.candidates.length === 1
                  ? "Orkestr found"
                  : `Orkestr found ${String(result.candidates.length)} places`}
              </p>
              <ul className="candidate-list">
                {result.candidates.map((candidate) => (
                  <li key={`${candidate.name}-${candidate.source.quote}`} className="candidate">
                    <div className="stack gap-1">
                      <strong>{candidate.name}</strong>
                      <span className="faint">
                        {categoryWords(candidate.category)}
                        {candidate.area !== undefined && ` · ${candidate.area}`}
                        {candidate.city !== undefined && ` · ${candidate.city}`}
                      </span>
                      {/* §62. Why this, from the words it actually came from. */}
                      <span className="candidate-why">“{candidate.source.quote}”</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      disabled={saved.includes(candidate.name)}
                      onClick={() =>
                        void save(candidate.name, candidate.category, candidate.source.quote)
                      }
                    >
                      {saved.includes(candidate.name) ? "Saved ✓" : "Save this place"}
                    </button>
                  </li>
                ))}
              </ul>
              {result.elsewhere.length > 0 && (
                <p className="notice notice-soft">
                  {result.elsewhere.join(", ")}{" "}
                  {result.elsewhere.length === 1 ? "looks like it is" : "look like they are"} in a
                  different city from {destination}. Save it anyway if you meant to.
                </p>
              )}
            </div>
          )}

          {/*
            §33. A link Orkestr could not read is not a dead end. It asks, and
            whatever the person answers is kept with the link.
          */}
          {result.question !== undefined && (
            <div className="stack gap-1">
              <p>{result.question}</p>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="manual-place">What is the place?</label>
                  <input
                    id="manual-place"
                    className="input"
                    placeholder="Gwangjang Market"
                    value={manual}
                    onChange={(event) => setManual(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={manual.trim().length === 0}
                  onClick={() => void save(manual.trim(), "FOOD")}
                >
                  Save it
                </button>
              </div>
            </div>
          )}

          <a
            className="linkish"
            href={result.source.originalUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            View original
          </a>
        </div>
      )}
    </div>
  );
}

function providerWords(provider: string): string {
  switch (provider) {
    case "TIKTOK":
      return "TikTok";
    case "YOUTUBE":
      return "YouTube";
    case "INSTAGRAM":
      return "Instagram";
    default:
      return "Link";
  }
}

function categoryWords(category: IdeaCategory): string {
  switch (category) {
    case "FOOD":
      return "Food";
    case "SHOPPING":
      return "Shopping";
    case "CULTURE":
      return "Culture";
    case "NIGHT":
      return "Nightlife";
    case "NATURE":
      return "Outdoors";
    case "FUN":
      return "Something fun";
    case "RELAX":
      return "Somewhere calm";
  }
}
