"use client";

import { useRouter } from "next/navigation";
import type { MemberInviteView } from "@/core/shared/views";
import { ShareScreen } from "./ShareScreen";
import { createInviteLink, revokeInviteLink } from "~/trip/[tripId]/share/actions";

/**
 * Binds the share screen to its server actions.
 *
 * The screen itself is presentational and knows nothing about routing, which
 * keeps it testable. The token returned by `createInviteLink` is handed
 * straight to the clipboard and never stored in React state, so it cannot end
 * up in a devtools inspection of this component.
 */
export function ShareScreenClient({
  tripId,
  destination,
  rows,
  canManage,
}: {
  readonly tripId: string;
  readonly destination: string;
  readonly rows: readonly MemberInviteView[];
  readonly canManage: boolean;
}) {
  const router = useRouter();

  return (
    <ShareScreen
      destination={destination}
      rows={rows}
      canManage={canManage}
      createInvite={async (memberId) => {
        const result = await createInviteLink(tripId, memberId);
        // Statuses change when a link is issued; refresh so the row is honest.
        if (result.ok) router.refresh();
        return result;
      }}
      revokeInvite={async (inviteId) => {
        const result = await revokeInviteLink(tripId, inviteId);
        router.refresh();
        return result;
      }}
    />
  );
}
