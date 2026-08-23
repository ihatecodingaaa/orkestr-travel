"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import type { MemberView } from "@/core/shared/views";
import type { TripActor } from "@/domain/sharedTrip";
import { Explore } from "@/ui/trip/Explore";
import { Plan } from "@/ui/trip/Plan";
import { Money } from "@/ui/trip/Money";
import { GroupScreen, Inbox, Activity } from "@/ui/trip/GroupScreens";
import { WhatIf } from "@/ui/trip/WhatIf";
import { sharedActions } from "./sharedActions";
import type { ActionOutcome, TripActions } from "@/ui/trip/actions";
import { useTripSync } from "./useTripSync";

/**
 * Any trip screen, for a shared trip.
 *
 * THE SAME COMPONENTS THE LOCAL PRODUCT USES. Not lookalikes, not a parallel
 * "shared app" -- the actual `Explore`, `Plan`, `GroupScreen` and `Inbox`. The
 * trip they receive was built on the server for this specific reader, so it
 * contains exactly what that person may see and nothing else.
 *
 * That is what makes "Lucas and Zen inhabit one product" true rather than
 * aspirational: there is one Plan screen, and if it changes it changes for
 * everybody in every mode.
 *
 * WRITES GO TO THE SERVER, ALWAYS. `sharedActions` turns a screen's request
 * into one typed intent carrying the version this browser was reading. Nothing
 * here touches `localStorage`, so a shared trip cannot end up half server and
 * half device.
 */

export type ScreenName =
  | "explore"
  | "plan"
  | "group"
  | "inbox"
  | "money"
  | "activity"
  | "whatif";

export function SharedScreen({
  screen,
  trip,
  actor,
  members,
  version,
}: {
  readonly screen: ScreenName;
  readonly trip: ConsumerTrip;
  readonly actor: TripActor;
  readonly members: readonly MemberView[];
  readonly version: number;
}) {
  const sync = useTripSync(version);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const you = members.find((member) => member.isYou);
  /**
   * Which traveller the reader IS, from the server's resolution. Not a picker,
   * not a query parameter: in shared mode there is no control that changes who
   * you are, because that control would be an impersonation endpoint.
   */
  const viewerId = you?.travellerId ?? "";
  const base = `/trip/${trip.id}`;

  const actions = wrap(
    sharedActions(trip.id, sync.version, () => {
      setNotice(undefined);
    }),
    setNotice,
  );

  return (
    <div className="stack gap-3">
      <SyncBanner state={sync.state} />

      {notice !== undefined && (
        <p className="notice notice-alert" role="alert">
          {notice}
        </p>
      )}

      {screen === "explore" && <Explore trip={trip} actions={actions} viewerId={viewerId} />}
      {screen === "plan" && <Plan trip={trip} base={base} actions={actions} />}
      {screen === "group" && (
        <GroupScreen trip={trip} base={base} viewerId={viewerId} />
      )}
      {screen === "inbox" && <Inbox trip={trip} base={base} viewerId={viewerId} />}
      {screen === "money" && <Money trip={trip} actions={actions} viewerId={viewerId} />}
      {screen === "activity" && <Activity trip={trip} />}
      {screen === "whatif" && <WhatIf trip={trip} actions={actions} />}

      <p className="faint">
        Shared with your group · {members.filter((member) => member.joined).length} of{" "}
        {members.length} joined
        {actor.role === "ORGANISER" ? " · you organise this trip" : ""}
      </p>
    </div>
  );
}

/**
 * Surface a refusal instead of swallowing it.
 *
 * A shared action can be declined -- the organiser owns the plan, the trip
 * moved, access expired. A control that silently does nothing is
 * indistinguishable from a broken one, so every refusal becomes a sentence.
 */
function wrap(
  actions: TripActions,
  setNotice: (message: string | undefined) => void,
): TripActions {
  const report = async (run: Promise<ActionOutcome>): Promise<ActionOutcome> => {
    const result = await run;
    setNotice(result.ok ? undefined : (result.message ?? "That didn't work."));
    return result;
  };

  return {
    addIdea: (input) => report(actions.addIdea(input)),
    toggleSave: (id) => report(actions.toggleSave(id)),
    removeIdea: (id) => report(actions.removeIdea(id)),
    addPlanItem: (input) => report(actions.addPlanItem(input)),
    movePlanItem: (id, to) => report(actions.movePlanItem(id, to)),
    setPlanItemStatus: (id, status) => report(actions.setPlanItemStatus(id, status)),
    removePlanItem: (id) => report(actions.removePlanItem(id)),
    setBudgetLine: (category, perPerson) => report(actions.setBudgetLine(category, perPerson)),
    setCurrency: (currency) => report(actions.setCurrency(currency)),
    setMyAvailability: (input) => report(actions.setMyAvailability(input)),
    addMyRequirement: (input) => report(actions.addMyRequirement(input)),
    removeMyRequirement: (id) => report(actions.removeMyRequirement(id)),
    applyWhatIf: (next, label) => report(actions.applyWhatIf(next, label)),
    setAutopilot: (patch) => report(actions.setAutopilot(patch)),
  };
}

/**
 * Sync feedback, kept quiet.
 *
 * No spinner on every poll, and no presence dots pretending to show who is
 * online. The only two things worth saying are "this just changed" and "Orkestr
 * cannot reach the trip".
 */
function SyncBanner({ state }: { readonly state: ReturnType<typeof useTripSync>["state"] }) {
  if (state === "IDLE") return null;

  if (state === "OFFLINE") {
    return (
      <p className="notice notice-soft" role="status">
        Orkestr can&rsquo;t reach this trip right now. What you can see may be out of date.
      </p>
    );
  }

  return (
    <p className="sync-note" role="status">
      {state === "REFRESHING" ? "Trip changed — refreshing…" : "Updated just now"}
    </p>
  );
}
