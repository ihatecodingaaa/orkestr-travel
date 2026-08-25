import type { ConsumerTrip } from "@/domain/consumerTrip";
import type {
  BudgetCategory,
  IdeaCategory,
  PlanItemKind,
  PlanItemStatus,
} from "@/domain/livingTrip";
import type { IsoDate } from "@/domain/time";

/**
 * What a screen can ask to happen.
 *
 * ONE INTERFACE, TWO IMPLEMENTATIONS, ONE SET OF SCREENS.
 *
 * Screens used to receive `save: (nextTrip) => void` and hand back a whole new
 * trip. That is exactly right for one browser that owns everything, and wrong
 * the moment four people share a trip: two of them editing different fields
 * would each send a complete copy, and the second to arrive would erase the
 * first's work without either of them touching the same thing.
 *
 * So a screen now says what it wants -- "save this idea", "move this item" --
 * and the mode decides how. Local applies the pure mutator and writes to the
 * browser. Shared sends the intent to the server, which authorises it, applies
 * the SAME pure mutator, and refuses it if the trip has moved.
 *
 * The screens do not know which one they have, which is the point: there is no
 * SharedPlanScreen to drift away from PlanScreen.
 *
 * Every method returns a promise so a screen can await the shared round trip.
 * Local resolves immediately.
 */

export interface ActionOutcome {
  readonly ok: boolean;
  /** Set when refused or conflicted. Consumer language, ready to display. */
  readonly message?: string;
}

export const OK: ActionOutcome = { ok: true };

export interface TripActions {
  /* --- ideas -------------------------------------------------------------- */
  addIdea(input: {
    readonly title: string;
    readonly category: IdeaCategory;
    readonly url?: string;
    readonly note?: string;
  }): Promise<ActionOutcome>;
  toggleSave(ideaId: string): Promise<ActionOutcome>;
  removeIdea(ideaId: string): Promise<ActionOutcome>;

  /* --- the plan ----------------------------------------------------------- */
  addPlanItem(input: {
    readonly day: IsoDate;
    readonly title: string;
    readonly kind: PlanItemKind;
    readonly startTime?: string;
    readonly area?: string;
    readonly fromIdeaId?: string;
  }): Promise<ActionOutcome>;
  /** How many people are coming, as the group stated it. Capacity, not people. */
  setDeclaredGroupSize(size: number): Promise<ActionOutcome>;
  /**
   * A generated draft, applied in one go.
   *
   * Separate from `addPlanItem` because a draft is one decision. In shared mode
   * it is also the only correct shape: a loop of single writes would have its
   * own first item invalidate the rest.
   */
  applyDraft(
    items: readonly {
      readonly day: IsoDate;
      readonly title: string;
      readonly kind: PlanItemKind;
      readonly startTime?: string;
      readonly area?: string;
      readonly fromIdeaId?: string;
    }[],
  ): Promise<ActionOutcome>;
  movePlanItem(
    itemId: string,
    to: { readonly day?: IsoDate; readonly startTime?: string },
  ): Promise<ActionOutcome>;
  setPlanItemStatus(itemId: string, status: PlanItemStatus): Promise<ActionOutcome>;
  removePlanItem(itemId: string): Promise<ActionOutcome>;

  /* --- money -------------------------------------------------------------- */
  setBudgetLine(category: BudgetCategory, perPerson: number | undefined): Promise<ActionOutcome>;
  setCurrency(currency: string): Promise<ActionOutcome>;

  /* --- yourself ----------------------------------------------------------- */
  setMyAvailability(input: {
    readonly from?: IsoDate;
    readonly to?: IsoDate;
    readonly coming?: boolean;
  }): Promise<ActionOutcome>;
  addMyRequirement(input: {
    readonly text: string;
    readonly strength: "REQUIRED" | "PREFERRED";
    readonly isPrivate: boolean;
  }): Promise<ActionOutcome>;
  removeMyRequirement(requirementId: string): Promise<ActionOutcome>;

  /**
   * Apply a what-if result.
   *
   * THE ONE WHOLE-TRIP WRITE, and it is one on purpose: a repair genuinely
   * rewrites the plan rather than changing a field, so describing it as a list
   * of field edits would be a fiction that loses the reason they belong
   * together.
   *
   * It is still version-guarded. A preview computed against v20 and applied
   * after somebody else reached v21 is refused, because the thing it promised
   * to preserve may no longer be there.
   */
  applyWhatIf(next: ConsumerTrip, label: string): Promise<ActionOutcome>;

  /**
   * Autopilot is a whole-object setting rather than a field-level change, and
   * it is local-only for now: nothing in shared mode writes it, so the shared
   * implementation refuses rather than pretending.
   */
  setAutopilot(patch: Partial<ConsumerTrip["autopilot"]>): Promise<ActionOutcome>;
}

/**
 * A refusal a screen can show.
 *
 * Used by the shared implementation for the handful of things it deliberately
 * does not do. Saying so is the point -- a control that silently does nothing
 * is indistinguishable from a bug.
 */
export function refuse(message: string): ActionOutcome {
  return { ok: false, message };
}
