import { describe, it, expect } from "vitest";
import { readModelStudioConfig } from "@/adapters/modelStudio/config";
import { HttpModelStudioTransport } from "@/adapters/modelStudio/transport";
import { readSharedLink } from "@/adapters/modelStudio/sharedLinkReader";
import { asSharedLinkId } from "@/domain/ids";
import { asIsoDateTime } from "@/domain/time";
import { loadLocalEnv, report, requireConfig } from "./harness";

/**
 * User-shared links, live.
 *
 *   npm run shared:live
 *
 * Two public URLs, chosen to test opposite outcomes:
 *
 *   1. An ordinary official page that should be readable.
 *   2. A social page that may well not be. **A block is a correct result**, not
 *      a failure of the test -- the property being checked is that an unreadable
 *      page produces EXTRACTION_UNAVAILABLE and nothing invented, rather than a
 *      confident guess about what the video probably showed.
 *
 * WHAT THIS DOES NOT DO: any first-party TikTok, Instagram or Reddit API, and
 * any scraping. The only mechanism is the provider's own extractor pointed at a
 * public URL a person pasted.
 *
 * WHAT IT CANNOT CONCLUDE: that a platform is or is not supported. One URL
 * working does not make TikTok supported, and one failing does not make it
 * unsupported. The report says what these specific URLs did.
 */

loadLocalEnv();

const config = readModelStudioConfig();
const configured = config.configured;

/** A real official page, already confirmed extractable by the research run. */
const ORDINARY_PAGE = "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/";

/** A public social URL. Whether this is readable is the open question. */
const SOCIAL_PAGE = "https://www.tiktok.com/@tokyo/video/7200000000000000000";

describe("live user-shared links", () => {
  it.skipIf(!configured)("reads an ordinary public page and infers only an interest", async () => {
    const live = requireConfig(config);
    const transport = new HttpModelStudioTransport(live, () => Date.now());

    const reading = await readSharedLink(ORDINARY_PAGE, {
      config: live,
      transport,
      now: asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
      id: asSharedLinkId("LINK-ORDINARY"),
    });

    report("ordinary public page", {
      url: reading.link.url,
      state: reading.link.state,
      platform: reading.link.platform ?? "(not a recognised platform)",
      durationMs: reading.durationMs,
      interest: reading.interest?.label ?? "(none proposed)",
      interestStatus: reading.interest?.status ?? "n/a",
      rejectionReason: reading.link.rejectionReason ?? "(none recorded)",
    });

    // Whatever happened, an interest may never arrive confirmed.
    if (reading.interest !== undefined) {
      expect(reading.interest.status).toBe("INFERRED");
    }
    // And a state must always be one of the honest ones.
    expect(["EXTRACTED", "EXTRACTION_UNAVAILABLE", "URL_REJECTED", "NOT_CONFIGURED"]).toContain(
      reading.link.state,
    );
  }, 180_000);

  it.skipIf(!configured)("reports a social page honestly, whichever way it goes", async () => {
    const live = requireConfig(config);
    const transport = new HttpModelStudioTransport(live, () => Date.now());

    const reading = await readSharedLink(SOCIAL_PAGE, {
      config: live,
      transport,
      now: asIsoDateTime(new Date().toISOString().replace("Z", "+00:00")),
      id: asSharedLinkId("LINK-SOCIAL"),
      userNote: "the night market bit",
    });

    report("social page", {
      url: reading.link.url,
      state: reading.link.state,
      platform: reading.link.platform ?? "(unrecognised)",
      durationMs: reading.durationMs,
      interest: reading.interest?.label ?? "(none proposed)",
      userNote: reading.link.userNote ?? "(none)",
      rejectionReason: reading.link.rejectionReason ?? "(none recorded)",
      verdict:
        reading.link.state === "EXTRACTED"
          ? "readable -- provenance recorded, interest stays INFERRED"
          : "not readable -- the honest outcome, nothing invented",
    });

    /**
     * The property that matters either way.
     *
     * If the page could not be read, no interest may exist. Producing one would
     * mean guessing the contents of a page we never saw, which is the single
     * worst thing this path could do.
     */
    if (reading.link.state !== "EXTRACTED") {
      expect(reading.interest).toBeUndefined();
    } else {
      expect(reading.interest?.status).toBe("INFERRED");
    }

    // The person's own words survive regardless. They are better evidence of
    // what they want than anything we could have read off the page.
    expect(reading.link.userNote).toBe("the night market bit");
    expect(reading.link.platform).toBe("TikTok");
  }, 180_000);
});
