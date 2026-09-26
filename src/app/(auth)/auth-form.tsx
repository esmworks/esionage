"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

/**
 * Shared sign-in / sign-up form. When reached from an OAuth authorization (MCP client
 * connecting), the page URL carries the signed authorization query; the oauth-provider
 * client plugin forwards it and the server answers with the URL to continue to.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
      return;
    }
    const data = result.data as { url?: string; redirect?: boolean } | null;
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-base font-semibold">{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
      {mode === "sign-up" && (
        <label className="block space-y-1.5">
          <span className="text-sm text-fg-muted">Name</span>
          <Input name="name" required autoComplete="name" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">Email</span>
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">Password</span>
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-fg-muted">
        {mode === "sign-in" ? "No account yet? " : "Already have an account? "}
        {/* Keep the OAuth query so a new user can finish connecting an app. */}
        <Link href={`/${mode === "sign-in" ? "sign-up" : "sign-in"}${search}`} className="text-accent hover:underline">
          {mode === "sign-in" ? "Create one" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}
