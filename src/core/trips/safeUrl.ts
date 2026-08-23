/**
 * Links somebody pasted.
 *
 * A trip is a place where people paste URLs from group chats without looking at
 * them. `javascript:alert(1)` in an idea's link field, rendered as an anchor,
 * is stored cross-site scripting that fires for every member of the trip -- and
 * the person who pasted it may not have known either.
 *
 * ALLOW-LIST, NOT DENY-LIST. Only `http` and `https` are accepted. A list of
 * dangerous schemes is a list somebody has to keep current against `data:`,
 * `vbscript:`, `blob:`, `filesystem:` and whatever a browser ships next.
 *
 * REJECTED AT THE BOUNDARY, not at render. A dangerous value that is merely not
 * displayed is still in storage, still in an export, and still one careless
 * component away from being a link.
 *
 * PURE.
 */

const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

/**
 * The URL if it is safe to keep, otherwise undefined.
 *
 * Returns undefined rather than throwing: somebody typing a half-finished URL
 * into a form is doing something ordinary, not something exceptional.
 */
export function safeUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  /**
   * A scheme-less value is treated as https rather than rejected. People paste
   * "gwangjang.market" and mean a website; refusing it teaches them the field
   * is broken. The parse below still has to succeed.
   */
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol.toLowerCase())) return undefined;
  // A URL with no host is not a link to anywhere: `http:///foo`, `https://`.
  if (parsed.hostname.length === 0) return undefined;

  return parsed.toString();
}

/** True when the value is safe to render as an anchor. */
export function isSafeUrl(raw: string | undefined): boolean {
  return safeUrl(raw) !== undefined;
}
