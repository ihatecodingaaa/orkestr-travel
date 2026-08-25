import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareScreen } from "@/ui/shared/ShareScreen";
import type { MemberInviteView } from "@/core/shared/views";

/**
 * Sending an invite is the moment a private plan becomes a group trip.
 *
 * Two things have to be true at once: it has to be the thing a person expects
 * on a phone -- the share sheet they use for everything else -- and the token
 * must never appear anywhere it could be read. Those pull in opposite
 * directions, which is why this is tested rather than assumed.
 */
const ROWS: readonly MemberInviteView[] = [
  { memberId: "m1", name: "Grandma", status: "NOT_INVITED" },
  { memberId: "m2", name: "Ryan", status: "JOINED" },
];

const SECRET_URL = "https://orkestr.example/join/TOKEN-THAT-MUST-NOT-RENDER";

function setup(overrides: Partial<Parameters<typeof ShareScreen>[0]> = {}) {
  const createInvite = vi.fn(async () => ({ ok: true as const, url: SECRET_URL }));
  render(
    <ShareScreen
      destination="Beijing"
      rows={ROWS}
      canManage
      createInvite={createInvite}
      revokeInvite={vi.fn(async () => ({ ok: true as const }))}
      {...overrides}
    />,
  );
  return { createInvite };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sending an invite from a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn(async () => undefined),
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("offers to SEND, not to copy, when the device can share", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send invite/i })).toBeInTheDocument();
    });
  });

  it("opens the device share sheet with a message a person would send", async () => {
    const { createInvite } = setup();
    await waitFor(() => screen.getByRole("button", { name: /send invite/i }));
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => {
      expect(navigator.share).toHaveBeenCalledTimes(1);
    });
    expect(createInvite).toHaveBeenCalledWith("m1");

    const payload = vi.mocked(navigator.share).mock.calls[0]?.[0];
    expect(payload?.url).toBe(SECRET_URL);
    expect(payload?.text).toContain("Beijing");
    expect(payload?.text).toContain("just for you");
    // §24: no security jargon in something somebody forwards to their grandmother.
    expect(payload?.text).not.toMatch(/token|bearer|secret|expires/i);
  });

  /**
   * The whole design is that the token never renders. A share sheet that
   * received it must not also have left it in the page.
   */
  it("never puts the invite link in the document", async () => {
    setup();
    await waitFor(() => screen.getByRole("button", { name: /send invite/i }));
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    await waitFor(() => {
      expect(navigator.share).toHaveBeenCalled();
    });
    expect(document.body.innerHTML).not.toContain("TOKEN-THAT-MUST-NOT-RENDER");
    expect(document.body.innerHTML).not.toContain(SECRET_URL);
  });

  it("treats a cancelled share as nothing having gone wrong", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn(async () => {
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      }),
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    setup();
    await waitFor(() => screen.getByRole("button", { name: /send invite/i }));
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    await waitFor(() => {
      expect(navigator.share).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    // The clipboard is not used as a consolation prize for a deliberate cancel.
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});

describe("sending an invite from a browser that cannot share", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("says copy, and copies", async () => {
    setup();
    const button = await screen.findByRole("button", { name: /copy invite/i });
    await userEvent.click(button);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET_URL);
    });
    expect(document.body.innerHTML).not.toContain(SECRET_URL);
  });
});

describe("what the group sees", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText: vi.fn() } });
  });

  /** §25: only states we actually know. No "seen", no "delivered". */
  it("claims nothing it cannot observe", async () => {
    setup();
    await screen.findByText("Grandma");
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/not invited/i);
    expect(text).toMatch(/joined/i);
    expect(text).not.toMatch(/\bseen\b|\bdelivered\b|\bread\b|\bopened\b/i);
  });

  it("offers a traveller no controls that would fail", () => {
    render(
      <ShareScreen
        destination="Beijing"
        rows={ROWS}
        canManage={false}
        createInvite={vi.fn()}
        revokeInvite={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/only the organiser can send invites/i).length).toBeGreaterThan(0);
  });
});
