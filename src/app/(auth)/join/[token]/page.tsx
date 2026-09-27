import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getMembership } from "@/server/access";
import { getSession } from "@/server/session";
import { findJoinLink } from "@/server/workspaces";
import { AuthForm } from "../../auth-form";
import { JoinWorkspace } from "./join-workspace";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("join");
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

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link, session, t] = await Promise.all([findJoinLink(token), getSession(), getTranslations("join")]);
  if (!link) return <Notice title={t("invalidTitle")} body={t("invalidBody")} href="/" link={t("home")} />;
  const title = t("title", { workspace: link.workspaceName });

  if (session) {
    if (await getMembership(session.user.id, link.workspaceId)) {
      return <Notice title={title} body={t("alreadyMember")} href={`/w/${link.workspaceId}`} link={t("open")} />;
    }
    return <JoinWorkspace token={token} title={title} body={t("body")} />;
  }

  // A join link never opens closed sign-up: anyone holding it could otherwise create accounts.
  if (env.signUpDisabled) {
    return (
      <Notice
        title={title}
        body={t("signInBody")}
        href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`}
        link={t("signIn")}
      />
    );
  }
  return <AuthForm mode="sign-up" join={token} title={title} />;
}
