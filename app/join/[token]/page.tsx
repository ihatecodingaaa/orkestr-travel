import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { asIsoDateTime } from "@/domain/time";
import { getRepository, previewInvite, sharedMode } from "@/server/shared/service";
import { SESSION_COOKIE } from "@/server/shared/sessionCookie";
import { JoinButton } from "@/ui/shared/JoinButton";

/**
 * The invite landing page.
 *
 * OPENING A LINK DOES NOT CONSUME IT. A person taps it in a group chat, sees
 * what they are joining, gets interrupted by the group chat, and comes back.
 * Redemption happens when they press the button, not when the page renders --
 * otherwise a link preview bot or an over-eager browser prefetch burns the
 * invite before the human sees it.
 *
 * NOINDEX AND NO REFERRER. The URL contains a live token until it is redeemed,
 * so this page must never be indexed and must never hand its own URL to a
 * third party through a Referer header.
 */

export const metadata: Metadata = {
  title: "Join a trip",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Tokens are per-request; there is nothing here worth caching. */
export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const mode = sharedMode();
  const repository = getRepository();

  if (!mode.available || repository === undefined) {
    return (
      <Shell>
        <h1 className="trip-title">Shared trips aren&rsquo;t set up here</h1>
        <p className="lede">
          {mode.available ? "Shared trips are unavailable right now." : mode.reason}
        </p>
        <p className="faint">
          You can still <Link href="/new">plan a trip on this device</Link>.
        </p>
      </Shell>
    );
  }

  const now = asIsoDateTime(new Date().toISOString());
  const result = await previewInvite(repository, { token, now });

  if (!result.ok) {
    return (
      <Shell>
        <h1 className="trip-title">This link doesn&rsquo;t work</h1>
        <p className="lede">{result.message}</p>
        <p className="faint">
          Nothing is wrong with your device — the organiser can send a new link.{" "}
          <Link href="/">Go to Orkestr</Link>.
        </p>
      </Shell>
    );
  }

  const { preview } = result;
  const store = await cookies();
  const hasSession = store.get(SESSION_COOKIE) !== undefined;

  return (
    <Shell>
      <p className="eyebrow">Orkestr</p>
      <h1 className="join-title">You&rsquo;re invited to {preview.destination}</h1>
      <p className="lede">
        {preview.travellerCount} {preview.travellerCount === 1 ? "traveller" : "travellers"}
      </p>

      <div className="join-card">
        <p className="faint">You&rsquo;ve been invited as</p>
        <p className="join-name">{preview.memberName}</p>
        <p className="muted">
          Tell Orkestr what matters to you. The group doesn&rsquo;t need another planning chat.
        </p>
        <JoinButton token={token} hasSession={hasSession} />
        {/*
          Said before they join, not after. Somebody deciding whether to hand a
          product their constraints should know the rule at that moment.
        */}
        <p className="faint">
          🔒 Anything you mark private stays private. The group is told a requirement exists,
          never what it says.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return <div className="shell join-shell stack gap-2">{children}</div>;
}
