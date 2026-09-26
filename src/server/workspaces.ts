import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/db";
import { user, workspace, workspaceInvitation, workspaceMember, type WorkspaceRole } from "@/db/schema";
import { isLocale, type Locale } from "@/i18n/config";
import { env } from "@/lib/env";
import { invitationEmail, mailStatus, sendMail } from "@/server/mail";
import { AccessError, requireMembership } from "@/server/access";
import { turkishGenitive } from "@/lib/turkish";
import { getCollab } from "@/server/collab/bridge";

/** "Erhan's workspace" / "Erhan'ın çalışma alanı", in the language of the sign-up request. */
async function personalWorkspaceName(userName: string) {
  const firstName = userName.trim().split(/\s+/)[0] || "My";
  try {
    const [locale, t] = await Promise.all([getLocale(), getTranslations("home")]);
    return t("personalWorkspace", { name: locale === "tr" ? turkishGenitive(firstName) : firstName });
  } catch {
    // Outside a request (scripts, tests) there is no locale to read.
    return `${firstName}'s workspace`;
  }
}

export async function createPersonalWorkspace(userId: string, userName: string) {
  const name = await personalWorkspaceName(userName);
  await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspace)
      .values({ name })
      .returning({ id: workspace.id });
    await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId, role: "owner" });
  });
}

export type WorkspaceErrorCode =
  | "nameRequired"
  | "alreadyMember"
  | "notMember"
  | "lastOwner"
  | "lastOwnerRemove"
  | "invitationInvalid"
  | "invitationEmailMismatch";

/**
 * An expected failure the user can act on. `code` is stable and translated by the UI; the
 * English `message` is for logs.
 */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export async function createWorkspace(userId: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new WorkspaceError("nameRequired", "Give the workspace a name.");
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspace).values({ name: clean }).returning({ id: workspace.id });
    await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId, role: "owner" });
    return ws;
  });
}

export async function getWorkspace(userId: string, workspaceId: string) {
  const { role } = await requireMembership(userId, workspaceId);
  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, icon: workspace.icon })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return { ...ws, role };
}

export async function renameWorkspace(userId: string, workspaceId: string, name: string) {
  await requireMembership(userId, workspaceId, "owner");
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new WorkspaceError("nameRequired", "Give the workspace a name.");
  await db.update(workspace).set({ name: clean }).where(eq(workspace.id, workspaceId));
}

export async function listMembers(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMember.role,
      joinedAt: workspaceMember.createdAt,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(asc(workspaceMember.createdAt));
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const invitationLink = (token: string) => `${env.appUrl}/invite/${token}`;

/**
 * - `sent`: the invitation email went out (or, in development without SMTP, to the log).
 * - `failed`: SMTP is set up but sending failed; the owner has to share the link.
 * - `off`: no email on this server; the owner shares the link.
 */
export type InvitationDelivery = "sent" | "failed" | "off";

export type AddMemberResult =
  | { kind: "added" }
  | { kind: "invited"; email: string; link: string; delivery: InvitationDelivery };

/** The inviter's interface language; the invitee has none yet. */
async function requestLocale(): Promise<Locale> {
  try {
    const locale = await getLocale();
    return isLocale(locale) ? locale : "en";
  } catch {
    return "en";
  }
}

async function emailInvitation(
  actorId: string,
  workspaceId: string,
  invitation: { email: string; role: WorkspaceRole; link: string },
): Promise<InvitationDelivery> {
  if (mailStatus() === "disabled") return "off";
  try {
    const [[inviter], [ws], locale] = await Promise.all([
      db.select({ name: user.name }).from(user).where(eq(user.id, actorId)).limit(1),
      db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1),
      requestLocale(),
    ]);
    const content = invitationEmail(locale, {
      inviterName: inviter?.name ?? "",
      workspaceName: ws?.name ?? "",
      ...invitation,
    });
    await sendMail({ to: invitation.email, ...content });
    return "sent";
  } catch (error) {
    console.error("could not send invitation email", error);
    return "failed";
  }
}

/**
 * Adds the account that uses this email. Without one, creates (or renews) an invitation and emails
 * its link when the server can send email; the owner can always share the link themselves.
 */
export async function addMember(
  actorId: string,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<AddMemberResult> {
  await requireMembership(actorId, workspaceId, "owner");
  const clean = normalizeEmail(email);
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, clean))
    .limit(1);
  if (!target) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await db
      .insert(workspaceInvitation)
      .values({ workspaceId, email: clean, role, token, invitedBy: actorId, expiresAt })
      .onConflictDoUpdate({
        target: [workspaceInvitation.workspaceId, workspaceInvitation.email],
        set: { role, token, invitedBy: actorId, expiresAt, createdAt: new Date() },
      });
    const link = invitationLink(token);
    const delivery = await emailInvitation(actorId, workspaceId, { email: clean, role, link });
    return { kind: "invited", email: clean, link, delivery };
  }
  const inserted = await db
    .insert(workspaceMember)
    .values({ workspaceId, userId: target.id, role })
    .onConflictDoNothing()
    .returning({ userId: workspaceMember.userId });
  await db
    .delete(workspaceInvitation)
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.email, clean)));
  if (!inserted.length) throw new WorkspaceError("alreadyMember", "This person is already a member.");
  return { kind: "added" };
}

/** Pending invitations, including expired ones so owners can renew them. Owners only. */
export async function listInvitations(actorId: string, workspaceId: string) {
  await requireMembership(actorId, workspaceId, "owner");
  const rows = await db
    .select({
      id: workspaceInvitation.id,
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      token: workspaceInvitation.token,
      expiresAt: workspaceInvitation.expiresAt,
    })
    .from(workspaceInvitation)
    .where(eq(workspaceInvitation.workspaceId, workspaceId))
    .orderBy(asc(workspaceInvitation.createdAt));
  return rows.map(({ token, ...row }) => ({ ...row, link: invitationLink(token) }));
}

export async function revokeInvitation(actorId: string, workspaceId: string, invitationId: string) {
  await requireMembership(actorId, workspaceId, "owner");
  await db
    .delete(workspaceInvitation)
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.id, invitationId)));
}

/** The unexpired invitation behind a link, or null. Callers must not reveal the token elsewhere. */
export async function findInvitation(token: string) {
  if (!token) return null;
  const [row] = await db
    .select({
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      workspaceId: workspaceInvitation.workspaceId,
      workspaceName: workspace.name,
    })
    .from(workspaceInvitation)
    .innerJoin(workspace, eq(workspace.id, workspaceInvitation.workspaceId))
    .where(and(eq(workspaceInvitation.token, token), gt(workspaceInvitation.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function emailHasAccount(email: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, normalizeEmail(email)))
    .limit(1);
  return Boolean(row);
}

/** Whether this link lets `email` create an account while public sign-up is closed. */
export async function invitationAllowsSignUp(token: string, email: string) {
  const invitation = await findInvitation(token);
  return invitation !== null && invitation.email === normalizeEmail(email);
}

/**
 * Redeems an invitation for the signed-in account. The account's email must be the invited one,
 * so a forwarded link can't be used by someone else. Returns the workspace id.
 */
export async function acceptInvitation(token: string, userId: string, userEmail: string) {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select({
        id: workspaceInvitation.id,
        workspaceId: workspaceInvitation.workspaceId,
        email: workspaceInvitation.email,
        role: workspaceInvitation.role,
      })
      .from(workspaceInvitation)
      .where(and(eq(workspaceInvitation.token, token), gt(workspaceInvitation.expiresAt, new Date())))
      .for("update");
    if (!invitation) throw new WorkspaceError("invitationInvalid", "This invitation is invalid or has expired.");
    if (invitation.email !== normalizeEmail(userEmail)) {
      throw new WorkspaceError("invitationEmailMismatch", "This invitation is for a different email address.");
    }
    await tx
      .insert(workspaceMember)
      .values({ workspaceId: invitation.workspaceId, userId, role: invitation.role })
      .onConflictDoNothing();
    await tx.delete(workspaceInvitation).where(eq(workspaceInvitation.id, invitation.id));
    return invitation.workspaceId;
  });
}

/** Locks the owner rows so concurrent demotions/removals can't leave a workspace ownerless. */
async function countOwners(workspaceId: string, tx: Pick<typeof db, "select">) {
  const owners = await tx
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "owner")))
    .for("update");
  return owners.length;
}

export async function setMemberRole(actorId: string, workspaceId: string, targetId: string, role: WorkspaceRole) {
  await requireMembership(actorId, workspaceId, "owner");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)))
      .for("update");
    if (!current) throw new WorkspaceError("notMember", "This person is not a member.");
    if (current.role === "owner" && role !== "owner" && (await countOwners(workspaceId, tx)) <= 1) {
      throw new WorkspaceError("lastOwner", "A workspace needs at least one owner.");
    }
    await tx
      .update(workspaceMember)
      .set({ role })
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)));
  });
}

/** Owners can remove anyone; members can only remove themselves (leave). */
export async function removeMember(actorId: string, workspaceId: string, targetId: string) {
  const actor = await requireMembership(actorId, workspaceId);
  if (actorId !== targetId && actor.role !== "owner") throw new AccessError();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)))
      .for("update");
    if (!current) throw new WorkspaceError("notMember", "This person is not a member.");
    if (current.role === "owner" && (await countOwners(workspaceId, tx)) <= 1) {
      throw new WorkspaceError("lastOwnerRemove", "A workspace needs at least one owner. Make someone else an owner first.");
    }
    await tx
      .delete(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)));
  });
  await getCollab().disconnectUser(targetId, workspaceId);
}
