/**
 * Shared, database-free pieces of the account page (see server/account.ts): error codes the UI
 * translates, limits, and what deleting an account does to each workspace.
 */

export type AccountErrorCode =
  | "proofRequired"
  | "wrongPassword"
  | "invalidCode"
  | "signInAgain"
  | "rateLimited"
  | "nameRequired"
  | "nameTooLong"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordAlreadySet"
  | "noPassword"
  | "mailDisabled"
  | "invalidEmail"
  | "sameEmail"
  | "linkInvalid"
  | "emailTaken"
  | "confirmationMismatch"
  | "soleOwner"
  | "currentSession"
  | "sessionNotFound"
  | "avatarType"
  | "avatarTooLarge"
  | "samePassword"
  | "resetStepExpired";

export const MAX_NAME_LENGTH = 80;
/** Same bounds Better Auth checks on sign-up and password changes. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
/** How long the link confirming a new email address works. */
export const EMAIL_CHANGE_HOURS = 24;
/**
 * Accounts with neither a password nor an authenticator app (GitHub or Google only) confirm
 * sensitive changes by having signed in this recently.
 */
export const FRESH_SIGN_IN_MINUTES = 10;

/** What a person proves they are with before a sensitive change, depending on their account. */
export type ProofKind = "password" | "code" | "recentSignIn";

export function proofKindFor(account: { hasPassword: boolean; twoFactorEnabled: boolean }): ProofKind {
  if (account.hasPassword) return "password";
  if (account.twoFactorEnabled) return "code";
  return "recentSignIn";
}

/** Proof sent along with a sensitive change: the current password, or a code. */
export type Proof = { password?: string; code?: string };

export function cleanName(name: unknown): { ok: true; name: string } | { ok: false; error: AccountErrorCode } {
  if (typeof name !== "string") return { ok: false, error: "nameRequired" };
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "nameRequired" };
  if ([...clean].length > MAX_NAME_LENGTH) return { ok: false, error: "nameTooLong" };
  return { ok: true, name: clean };
}

export function passwordProblem(password: unknown): AccountErrorCode | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return "passwordTooShort";
  if (password.length > MAX_PASSWORD_LENGTH) return "passwordTooLong";
  return null;
}

export type WorkspaceStanding = {
  id: string;
  name: string;
  role: "owner" | "member" | "guest";
  /** People in the workspace, guests and this person included. */
  people: number;
  owners: number;
};

export type DeletionPlan = {
  /** Workspaces shared with others where this person is the only owner: deleting is refused. */
  blockers: { id: string; name: string }[];
  /** Workspaces nobody else is in: deleted along with the account. */
  deleted: { id: string; name: string }[];
  /** Workspaces shared with others: the person leaves, and an owner takes over pages only they managed. */
  left: { id: string; name: string }[];
};

/**
 * What deleting the account does to each workspace. A workspace needs an owner, so being its only
 * owner while others are in it blocks the deletion until ownership is handed over.
 */
export function planAccountDeletion(standings: WorkspaceStanding[]): DeletionPlan {
  const plan: DeletionPlan = { blockers: [], deleted: [], left: [] };
  for (const w of standings) {
    const entry = { id: w.id, name: w.name };
    if (w.people <= 1) plan.deleted.push(entry);
    else if (w.role === "owner" && w.owners <= 1) plan.blockers.push(entry);
    else plan.left.push(entry);
  }
  return plan;
}

/** The confirmation typed into the delete dialog: the account's email, in any case. */
export function confirmsDeletion(typed: unknown, email: string) {
  return typeof typed === "string" && typed.trim().toLowerCase() === email.trim().toLowerCase();
}
