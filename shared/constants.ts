// Shared client/server constants.

// Session cookie name is per-app (derived from APP_SLUG) so two apps served on
// the same host cannot clobber each other's session cookie (DESIGN #13). The
// server owns the authoritative value via env; this helper keeps client/server
// in agreement.
export function sessionCookieName(slug: string): string {
  return `app_session_${slug}`;
}

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// How much of a WAME API key is shown back to its owner: the first N and last M
// characters, never the middle. The full key lives only in the database and in
// outbound server calls.
export const WAME_API_KEY_MASK_PREFIX = 4;
export const WAME_API_KEY_MASK_SUFFIX = 2;

// A status stays live in the app for 24 hours; the panel keeps the record much
// longer, so this is only used for display copy and the "live now" badge.
export const STATUS_LIFETIME_HOURS = 24;
export const STATUS_LIFETIME_MS = STATUS_LIFETIME_HOURS * 60 * 60 * 1000;
