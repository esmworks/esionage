import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getSession } from "@/server/session";
import { emailHasAccount, findInvitation } from "@/server/workspaces";
import { AuthForm } from "../../auth-form";
import { AcceptInvitation } from "./accept-invitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("metaTitle") };
}

function Notice({ title, body, href, link }: { title: string; body: string; href: string; link: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="text-sm text-fg-muted">{body}</p>
      <p className="text-center text-sm">
        <Link href={href} className="text-accent hover:underline">
          {link}
        </Link>
      </p>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, session, t, tRoles] = await Promise.all([
    findInvitation(token),
    getSession(),
    getTranslations("invite"),
    getTranslations("settings.members.roles"),
  ]);
  if (!invitation) {
    return <Notice title={t("invalidTitle")} body={t("invalidBody")} href="/" link={t("home")} />;
  }
  const title = t("title", { workspace: invitation.workspaceName });

  if (session) {
    if (session.user.email.toLowerCase() !== invitation.email) {
      return (
        <Notice
          title={title}
          body={t("wrongAccount", { email: invitation.email, current: session.user.email })}
          href="/"
          link={t("home")}
        />
      );
    }
    return (
      <AcceptInvitation
        token={token}
        title={title}
        body={t("acceptBody", { role: tRoles(invitation.role) })}
      />
    );
  }

  if (await emailHasAccount(invitation.email)) {
    return (
      <Notice
        title={title}
        body={t("signInBody", { email: invitation.email })}
        href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
        link={t("signIn")}
      />
    );
  }

  return (
    <AuthForm
      mode="sign-up"
      invite={{ token, email: invitation.email }}
      title={title}
      socialProviders={env.enabledSocialProviders}
    />
  );
}
