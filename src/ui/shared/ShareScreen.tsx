"use client";

import { useEffect, useState } from "react";
import type { MemberInviteView } from "@/core/shared/views";

/**
 * The share screen.
 *
 * ONE ROW PER PERSON, and the row says what to do next. An organiser who has
 * added five people needs to know which of them can actually get in, and the
 * honest answer differs per person: not invited, invited, joined.
 *
 * NO TOKEN IS EVER RENDERED. The link is fetched when the organiser presses
 * Copy and goes straight to the clipboard. It is not in the page source, not in
 * a data attribute, and not in a React payload -- so a screenshot of this
 * screen, or a "view source" during a demo, gives nobody access to anything.
 *
 * That is also why Copy cannot be undone or re-read: a token you can look up
 * later is a token stored somewhere. Copy again issues a NEW link and kills the
 * old one, which is the safe default and matches what somebody means when they
 * say "send it again".
 */

export type ShareAction = (memberId: string) => Promise<
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }
>;

const STATUS_WORDS: Record<MemberInviteView["status"], string> = {
  JOINED: "Joined",
  INVITE_READY: "Invited",
  NOT_INVITED: "Not invited",
  INVITE_EXPIRED: "Invite expired",
  INVITE_REVOKED: "Invite revoked",
};

export function ShareScreen({
  destination,
  rows,
  createInvite,
  revokeInvite,
  canManage,
  compact = false,
}: {
  readonly destination: string;
  readonly rows: readonly MemberInviteView[];
  readonly createInvite: ShareAction;
  readonly revokeInvite: (inviteId: string) => Promise<{ readonly ok: boolean }>;
  readonly canManage: boolean;
  /** Rendered inside another screen's section, so it brings no heading. */
  readonly compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  /**
   * Whether this device can open its own share sheet.
   *
   * Detected AFTER mount, deliberately. The server has no idea what the browser
   * can do, so deciding the button's wording during render would mean the first
   * paint says one thing and the hydrated page says another -- which React
   * treats as a mismatch and a person reads as a flicker. Until this resolves
   * the button says the thing that is true everywhere.
   */
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator.share === "function");
  }, []);
  const [error, setError] = useState<string | undefined>(undefined);

  async function copyFor(memberId: string) {
    setBusy(memberId);
    setError(undefined);
    try {
      const result = await createInvite(memberId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      /**
       * THE PHONE'S OWN SHARE SHEET FIRST.
       *
       * This is a group product, and the moment an invite exists the next thing
       * a person does is send it to somebody in WhatsApp or Messages. Copying to
       * a clipboard and hoping they find the right conversation is the desktop
       * answer to a phone problem.
       *
       * `navigator.share` opens the native sheet on iOS and Android. It must be
       * called directly inside the click, which is why the link is created and
       * shared in the same handler rather than in two steps.
       *
       * THE TOKEN STILL NEVER RENDERS. It goes from the server action into the
       * share sheet or the clipboard and nowhere else -- not into React state,
       * not into the DOM, not into a devtools inspection of this component.
       */
      const message = `Join our ${destination} trip on Orkestr. This invite is just for you.`;
      const shareable =
        typeof navigator.share === "function" &&
        (typeof navigator.canShare !== "function" ||
          navigator.canShare({ text: message, url: result.url }));

      if (shareable) {
        try {
          await navigator.share({ title: `${destination} on Orkestr`, text: message, url: result.url });
          setCopied(memberId);
          setTimeout(() => { setCopied(undefined); }, 3000);
          return;
        } catch (shareError) {
          /**
           * A cancelled share is not a failure. Somebody who opened the sheet
           * and changed their mind should not be told something went wrong --
           * the link exists either way, and the row now says so.
           */
          if (shareError instanceof Error && shareError.name === "AbortError") return;
          // Anything else: fall through and try the clipboard.
        }
      }

      /**
       * Clipboard can be refused (permissions, insecure context, an older
       * browser). Falling back to showing the link is worse than saying so:
       * the whole design is that the token never renders.
       */
      try {
        await navigator.clipboard.writeText(result.url);
        setCopied(memberId);
        setTimeout(() => { setCopied(undefined); }, 3000);
      } catch {
        setError(
          "Orkestr couldn't reach your clipboard. Try again, or use a browser that allows copying.",
        );
      }
    } finally {
      setBusy(undefined);
    }
  }

  if (!canManage) {
    return (
      <div className="empty-panel">
        <h3>Only the organiser can send invites</h3>
        <p className="faint">
          Ask them to send a link to anyone still missing from {destination}.
        </p>
      </div>
    );
  }

  return (
    <div className="stack gap-3">
      {/*
        The heading is omitted where this list sits UNDER one.
        §19: the Group screen shows who is here and who still needs an invite,
        and repeating "Your group" above a list that is already under "Your
        group" makes one screen look like two.
      */}
      {!compact && (
        <div>
          <h2>Your group</h2>
          <p className="faint">
            Send each person their own link. Orkestr gives everyone their own view — nobody has to
            share a password, and nobody can answer for anyone else.
          </p>
        </div>
      )}

      {error !== undefined && (
        <p className="notice notice-alert" role="alert">
          {error}
        </p>
      )}

      <ul className="share-list">
        {rows.map((row) => (
          <li key={row.memberId} className="share-row">
            <div className="share-who">
              <strong>{row.name}</strong>
              <span className={`status status-${row.status.toLowerCase()}`}>
                {STATUS_WORDS[row.status]}
              </span>
            </div>

            <div className="share-actions">
              {row.status === "JOINED" ? (
                <span className="faint">Nothing to do</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={busy === row.memberId}
                    onClick={() => void copyFor(row.memberId)}
                  >
                    {busy === row.memberId
                      ? "Making a link…"
                      : copied === row.memberId
                        ? canNativeShare
                          ? "Sent ✓"
                          : "Copied ✓"
                        : row.status === "NOT_INVITED"
                          ? canNativeShare
                            ? "Send invite"
                            : "Copy invite"
                          : "New link"}
                  </button>

                  {row.status === "INVITE_READY" && row.inviteId !== undefined && (
                    <button
                      type="button"
                      className="linkish danger"
                      onClick={() => void revokeInvite(row.inviteId!)}
                    >
                      Revoke
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="faint">
        A link works once and expires in seven days. Sending a new one to somebody replaces their
        old link.
      </p>
    </div>
  );
}
