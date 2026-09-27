/**
 * Better Auth error codes from the two-step verification and passkey endpoints, mapped to our own
 * wording (`security.errors.*`). `null` means say nothing: the person closed the browser's passkey
 * prompt themselves.
 */
const KEYS = {
  INVALID_PASSWORD: "wrongPassword",
  INVALID_CODE: "invalidCode",
  INVALID_BACKUP_CODE: "invalidCode",
  TWO_FACTOR_CODE_REQUIRED: "codeRequired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "tooManyCodes",
  INVALID_TWO_FACTOR_COOKIE: "challengeExpired",
  ACCOUNT_TEMPORARILY_LOCKED: "locked",
  TOTP_ALREADY_ENABLED: "alreadyEnabled",
  SESSION_NOT_FRESH: "signInAgain",
  PREVIOUSLY_REGISTERED: "passkeyExists",
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: "passkeyExists",
  PASSKEY_NOT_FOUND: "passkeyUnknown",
  AUTHENTICATION_FAILED: "passkeyFailed",
  FAILED_TO_VERIFY_REGISTRATION: "passkeyFailed",
} as const;

const CANCELLED = new Set([
  "AUTH_CANCELLED",
  "REGISTRATION_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  // The browser reports a closed or timed-out prompt as NotAllowedError.
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

export type SecurityErrorKey = (typeof KEYS)[keyof typeof KEYS] | "tooManyAttempts" | "generic";

export function securityErrorKey(error: { code?: string | null; status?: number } | null | undefined): SecurityErrorKey | null {
  if (!error) return null;
  if (error.code && CANCELLED.has(error.code)) return null;
  // Before the status: a locked account also answers 429.
  if (error.code && Object.hasOwn(KEYS, error.code)) return KEYS[error.code as keyof typeof KEYS];
  if (error.status === 429) return "tooManyAttempts";
  return "generic";
}
