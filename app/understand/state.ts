import type { UnderstandingModel, UnderstandingFailureModel } from "@/ui/view/understanding";
import type { UnderstandingMode } from "@/domain/extraction";

/**
 * The understanding screen's state shape.
 *
 * Kept OUT of `actions.ts` because a `"use server"` module may export nothing
 * but async functions: every export in one becomes a callable server endpoint,
 * so a constant beside an action is a build error rather than a style choice.
 */
export interface UnderstandingActionState {
  readonly status: "IDLE" | "SUCCESS" | "FAILED";
  readonly mode: UnderstandingMode;
  readonly model?: UnderstandingModel;
  readonly failure?: UnderstandingFailureModel;
  /** Safe metadata for the run, shown so a judge can see what really happened. */
  readonly diagnostics?: {
    readonly providerName: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly durationMs: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  /** True when the fixture provider was asked to read text it has no reading of. */
  readonly unrecognisedFixtureInput?: boolean;
}

export const IDLE_UNDERSTANDING: UnderstandingActionState = {
  status: "IDLE",
  mode: "NOT_CONFIGURED",
};
