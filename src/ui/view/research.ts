import type {
  EvidenceClaim,
  EvidenceLedger,
  ResearchSource,
  SourceAuthority,
} from "../../domain/evidence";
import type {
  EvidenceBackedJourneySuggestion,
  ResearchAnswer,
  ResearchFailureCode,
  ResearchQuestion,
  SharedLink,
  SuggestionUnknown,
} from "../../domain/research";
import type { TruthTone } from "./truth";

/**
 * Presenting research.
 *
 * The whole point of the research screen is that a person can check the work.
 * So every claim shows its sources, every source shows what kind of source it
 * is, disagreements are shown as disagreements, and anything unresolved is named
 * rather than left off.
 *
 * WHAT THIS MODULE NEVER PRODUCES: raw extracted page text. Dumping a scraped
 * article onto a screen is neither useful nor ours to republish. What is shown
 * is the structured claim and a link to the page it came from.
 *
 * PURE. Every judgement about what a source may establish was already made in
 * `core/research`; this only chooses words.
 */

export interface SourceModel {
  readonly url: string;
  readonly title: string;
  readonly host: string;
  readonly authorityLabel: string;
  readonly authorityExplanation: string;
  readonly originLabel: string;
  readonly retrievedAt: string;
  readonly publishedAt?: string;
  readonly freshnessLabel: string;
  readonly tone: TruthTone;
  /** True when the source may be opened. False for anything not retrieved. */
  readonly linkable: boolean;
}

/**
 * How each authority is described, and what it is allowed to establish.
 *
 * The explanation is not decoration. "Community source" beside a claim about
 * step-free access is the difference between a reader relying on it and a reader
 * ringing the venue, and the sentence is what makes that difference legible.
 */
function authorityLabel(authority: SourceAuthority): { label: string; explanation: string; tone: TruthTone } {
  switch (authority) {
    case "OFFICIAL_WEB":
      return {
        label: "Official",
        explanation: "An operator, venue or authority page. It can establish operational facts.",
        tone: "verified",
      };
    case "PROVIDER":
      return {
        label: "Provider",
        explanation: "A booking or travel provider's own system.",
        tone: "verified",
      };
    case "COMMUNITY":
      return {
        label: "Community",
        explanation:
          "Somebody describing their experience. It can tell you what a visit was like. It cannot establish access, opening times or safety.",
        tone: "neutral",
      };
    case "EDITORIAL":
      return {
        label: "Editorial",
        explanation: "A published guide or article. Context, not an operator's statement.",
        tone: "neutral",
      };
    case "UNKNOWN":
      return {
        label: "Unrecognised source",
        explanation:
          "This site is not one Orkestr recognises, so what it is allowed to establish is unknown.",
        tone: "unknown",
      };
  }
}

export function buildSourceModel(source: ResearchSource): SourceModel {
  const authority = authorityLabel(source.authority);
  const freshness =
    source.freshness === "UNDATED"
      ? "No publication date found"
      : source.freshness === "FRESH"
        ? "Recent"
        : source.freshness === "AGEING"
          ? "A year or more old"
          : "Older than two years";

  return {
    url: source.url,
    title: source.title ?? source.host,
    host: source.host,
    authorityLabel: authority.label,
    authorityExplanation: authority.explanation,
    originLabel:
      source.ingestionOrigin === "WEB_SEARCH"
        ? "Found by web search"
        : source.ingestionOrigin === "USER_SHARED"
          ? "Shared by a traveller"
          : source.ingestionOrigin === "RECORDED_WEB"
            ? "From a recorded result"
            : "Local fixture",
    retrievedAt: source.retrievedAt,
    ...(source.observedAt === undefined ? {} : { publishedAt: source.observedAt }),
    freshnessLabel: freshness,
    tone: authority.tone,
    linkable: source.ingestionOrigin !== "LOCAL_FIXTURE",
  };
}

export interface ClaimModel {
  readonly statement: string;
  readonly kindLabel: string;
  readonly stateLabel: string;
  readonly stateExplanation: string;
  readonly tone: TruthTone;
  readonly needsConfirmation: boolean;
  readonly sources: readonly SourceModel[];
  /** Statements this one disagrees with. Never shown without both sides. */
  readonly conflictsWith: readonly string[];
}

function stateWords(claim: EvidenceClaim): { label: string; explanation: string; tone: TruthTone } {
  switch (claim.state) {
    case "MULTI_SOURCE_SUPPORTED":
      return {
        label: "Several sources",
        explanation: "More than one source said this, and they agreed.",
        tone: claim.claimType === "OPERATIONAL_FACT" ? "verified" : "neutral",
      };
    case "SINGLE_SOURCE":
      return {
        label: "One source",
        explanation: "Exactly one source said this. Real, but thin.",
        tone: claim.claimType === "OPERATIONAL_FACT" ? "verified" : "neutral",
      };
    case "MIXED":
      return {
        label: "Sources differ in detail",
        explanation: "The sources broadly agree but not on the specifics.",
        tone: "pending",
      };
    case "CONFLICTING":
      return {
        label: "Sources disagree",
        explanation:
          "Two sources say different things. Both are shown, and neither has been treated as the answer.",
        tone: "alert",
      };
    case "STALE":
      return {
        label: "Out of date",
        explanation: "Every source behind this is more than two years old.",
        tone: "pending",
      };
    case "UNVERIFIED":
      return {
        label: "No source",
        explanation:
          "This was stated with no source Orkestr could verify, so it is shown but not relied on.",
        tone: "unknown",
      };
    case "EXTRACTION_FAILED":
      return {
        label: "Page could not be read",
        explanation: "A page was selected but could not be read, so nothing was established.",
        tone: "unknown",
      };
  }
}

function claimKindLabel(claim: EvidenceClaim): string {
  switch (claim.claimType) {
    case "OPERATIONAL_FACT":
      return "Operational fact";
    case "COMMUNITY_SIGNAL":
      return "What visitors said";
    case "EDITORIAL_CONTEXT":
      return "Published context";
    case "INFERRED_INTEREST":
      return "Read between the lines";
  }
}

export function buildClaimModels(ledger: EvidenceLedger): readonly ClaimModel[] {
  const sourcesById = new Map<string, ResearchSource>();
  for (const source of ledger.sources) sourcesById.set(source.id, source);
  const statementById = new Map<string, string>();
  for (const claim of ledger.claims) statementById.set(claim.id, claim.statement);

  return ledger.claims.map((claim) => {
    const words = stateWords(claim);
    return {
      statement: claim.statement,
      kindLabel: claimKindLabel(claim),
      stateLabel: words.label,
      stateExplanation: words.explanation,
      tone: words.tone,
      needsConfirmation: claim.needsConfirmation,
      sources: claim.sourceIds
        .map((id) => sourcesById.get(id as string))
        .filter((s): s is ResearchSource => s !== undefined)
        .map(buildSourceModel),
      conflictsWith: claim.conflictsWithClaimIds
        .map((id) => statementById.get(id as string))
        .filter((s): s is string => s !== undefined),
    };
  });
}

/** How an unknown reads to somebody deciding whether to rely on a suggestion. */
export function unknownLabel(unknown: SuggestionUnknown): string {
  switch (unknown) {
    case "TRAVEL_TIME_UNVERIFIED":
      return "How long it takes to get there has not been checked.";
    case "OPENING_HOURS_UNVERIFIED":
      return "Opening times were not confirmed by an official source.";
    case "ACCESSIBILITY_UNVERIFIED":
      return "No official source confirmed the access this group needs.";
    case "GROUP_CAPACITY_UNVERIFIED":
      return "Whether a group this size can be seated together is not known.";
    case "RESERVATION_AVAILABILITY_UNKNOWN":
      return "Nothing can be reserved from here, and availability is not known.";
    case "DIETARY_FIT_UNVERIFIED":
      return "The stated dietary requirement was not confirmed by an official source.";
  }
}

export interface SuggestionModel {
  readonly title: string;
  readonly what: string;
  readonly candidateSlot: string;
  readonly travellerNames: readonly string[];
  /** "Why Orkestr suggested this". Every line traceable. */
  readonly reasons: readonly { readonly text: string; readonly basisLabel: string }[];
  readonly unknowns: readonly string[];
  readonly confirmationsNeeded: readonly string[];
  /** Always "Suggested". Nothing here has been arranged or verified. */
  readonly statusLabel: string;
}

export function buildSuggestionModel(
  suggestion: EvidenceBackedJourneySuggestion,
  travellerNames: ReadonlyMap<string, string>,
): SuggestionModel {
  return {
    title: suggestion.title,
    what: suggestion.what,
    candidateSlot: suggestion.candidateSlot,
    travellerNames: suggestion.travellerIds.map(
      (id) => travellerNames.get(id as string) ?? "a traveller",
    ),
    reasons: suggestion.whyItMayFit.map((reason) => ({
      text: reason.text,
      basisLabel: reason.basis === "EVIDENCE" ? "From a source" : "Checked by Orkestr",
    })),
    unknowns: suggestion.unknowns.map(unknownLabel),
    confirmationsNeeded: [...suggestion.confirmationsNeeded],
    // There is no path that produces any other value here. A suggestion is a
    // suggestion however good its sources are.
    statusLabel: "Suggested",
  };
}

export interface ResearchFailureModel {
  readonly title: string;
  readonly detail: string;
  readonly tone: TruthTone;
}

export function researchFailureModel(code: ResearchFailureCode): ResearchFailureModel {
  switch (code) {
    case "RESEARCH_NOT_CONFIGURED":
      return {
        title: "No research provider is configured",
        detail: "There is no Model Studio credential in this build, so no search was made.",
        tone: "unknown",
      };
    case "RESEARCH_UNAVAILABLE":
      return {
        title: "Research could not run",
        detail: "The provider could not be reached. Nothing below came from it.",
        tone: "alert",
      };
    case "RESEARCH_TIMEOUT":
      return {
        title: "Research took too long",
        detail: "The search passed its time limit and was stopped rather than left running.",
        tone: "alert",
      };
    case "WEB_SEARCH_FAILED":
      return {
        title: "The web search failed",
        detail: "The search step did not complete, so no sources were collected.",
        tone: "alert",
      };
    case "WEB_EXTRACTION_BLOCKED":
      return {
        title: "The pages could not be read",
        detail:
          "Pages were found but could not be read automatically. This is normal for some sites and nothing has been guessed in their place.",
        tone: "pending",
      };
    case "ZERO_SOURCES":
      return {
        title: "Nothing was found",
        detail: "The search returned no usable public sources for this question.",
        tone: "unknown",
      };
    case "MALFORMED_JSON":
    case "SCHEMA_INVALID":
      return {
        title: "The answer could not be read",
        detail:
          "Sources were retrieved, but the structured answer about them was not readable. The sources are listed; no claim was taken from the reply.",
        tone: "alert",
      };
    case "RESEARCH_LIMIT_REACHED":
      return {
        title: "Research limit reached",
        detail:
          "This run hit its bound on searches or sources. What is shown is partial, and it is not a complete answer.",
        tone: "pending",
      };
  }
}

export interface SharedLinkModel {
  readonly url: string;
  readonly platform?: string;
  readonly stateLabel: string;
  readonly detail: string;
  readonly tone: TruthTone;
  readonly linkable: boolean;
  /** True when the person should be invited to say why they saved it. */
  readonly askWhySaved: boolean;
  readonly userNote?: string;
}

export function buildSharedLinkModel(link: SharedLink): SharedLinkModel {
  const platform = link.platform;
  switch (link.state) {
    case "EXTRACTED":
      return {
        url: link.url,
        ...(platform === undefined ? {} : { platform }),
        stateLabel: "Read",
        detail:
          "Orkestr read this page and proposed an interest from it. That is a suggestion about you, not a decision.",
        tone: "neutral",
        linkable: true,
        askWhySaved: false,
        ...(link.userNote === undefined ? {} : { userNote: link.userNote }),
      };
    case "EXTRACTION_UNAVAILABLE":
      return {
        url: link.url,
        ...(platform === undefined ? {} : { platform }),
        stateLabel: "Could not be read",
        detail:
          "We could not read this page automatically. That is normal for some sites, and nothing about its contents has been guessed.",
        tone: "pending",
        linkable: true,
        askWhySaved: link.userNote === undefined,
        ...(link.userNote === undefined ? {} : { userNote: link.userNote }),
      };
    case "URL_REJECTED":
      return {
        url: link.url,
        ...(platform === undefined ? {} : { platform }),
        stateLabel: "Not opened",
        detail: link.rejectionReason ?? "That address was not one Orkestr will open.",
        tone: "alert",
        // Deliberately not a link: it was refused, so it is not offered.
        linkable: false,
        askWhySaved: false,
      };
    case "NOT_CONFIGURED":
      return {
        url: link.url,
        ...(platform === undefined ? {} : { platform }),
        stateLabel: "Saved, not read",
        detail:
          "No page-reading provider is configured in this build, so the link was saved without being opened.",
        tone: "unknown",
        linkable: true,
        askWhySaved: link.userNote === undefined,
        ...(link.userNote === undefined ? {} : { userNote: link.userNote }),
      };
  }
}

/** A plain-language description of what was actually asked. */
export function describeQuestion(question: ResearchQuestion): string {
  const context = question.context;
  const parts = [
    `${question.destinationLabel}, for a group of ${String(context.groupSize)}`,
  ];
  if (context.statedInterests.length > 0) {
    parts.push(`interested in ${context.statedInterests.join(" and ")}`);
  }
  if (context.accessibilityNeeds.length > 0) {
    parts.push(
      `with a stated need for ${context.accessibilityNeeds
        .map((n) => n.toLowerCase().replace(/_/g, " "))
        .join(" and ")}`,
    );
  }
  if (context.pace !== undefined) parts.push(`at a ${context.pace.toLowerCase()} pace`);
  return parts.join(", ");
}

/** What the run actually cost and collected. Real counts, never estimates. */
export interface ResearchSpendModel {
  readonly lines: readonly string[];
  readonly limitReached: boolean;
}

export function buildSpendModel(answer: ResearchAnswer): ResearchSpendModel {
  const spend = answer.diagnostics.spend;
  const lines = [
    `${String(spend.searchOperations)} search${spend.searchOperations === 1 ? "" : "es"}`,
    `${String(spend.sourcesCollected)} source${spend.sourcesCollected === 1 ? "" : "s"} collected`,
    `${String(spend.pagesExtracted)} page${spend.pagesExtracted === 1 ? "" : "s"} read`,
    `${String(spend.providerCalls)} provider call${spend.providerCalls === 1 ? "" : "s"}`,
  ];
  if (spend.inputTokens !== undefined && spend.outputTokens !== undefined) {
    lines.push(
      `${String(spend.inputTokens)} in / ${String(spend.outputTokens)} out tokens`,
    );
  }
  return { lines, limitReached: answer.diagnostics.limitReached };
}
