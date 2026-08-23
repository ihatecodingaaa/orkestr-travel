"use client";

import { useActionState } from "react";
import { joinTrip } from "~/join/[token]/actions";

/**
 * The Join button.
 *
 * A FORM, NOT AN onClick FETCH. It posts to a server action, so the token
 * travels in a request body rather than being read out of the URL by client
 * JavaScript and passed around. It also works before hydration, which matters
 * for a link opened on a phone on a train.
 *
 * The disabled state during submission exists to stop a double tap redeeming
 * twice. It is not the real protection -- the store refuses a second redemption
 * atomically -- but it stops the person seeing a confusing error for something
 * that was actually their own second tap.
 */
export function JoinButton({
  token,
  hasSession,
}: {
  readonly token: string;
  readonly hasSession: boolean;
}) {
  const [state, action, pending] = useActionState(joinTrip, undefined);

  return (
    <form action={action} className="stack gap-1">
      <input type="hidden" name="token" value={token} />
      <button className="btn btn-primary btn-large" type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join the trip"}
      </button>

      {state?.error !== undefined && (
        <p className="notice notice-alert" role="alert">
          {state.error}
        </p>
      )}

      {!hasSession && (
        <p className="faint">
          No account needed. Orkestr remembers this browser so you can come back.
        </p>
      )}
    </form>
  );
}
