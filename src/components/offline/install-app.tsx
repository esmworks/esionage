"use client";

import { MonitorDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { MenuItem } from "@/components/ui";

/** Chrome/Edge's install prompt event (not in the DOM typings). */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Keeps the browser's install prompt for the "Install app" menu item instead of letting it pop up
 * on its own (mobile Chrome shows a banner otherwise): installing is offered, never pushed.
 */
function captureInstallPrompt() {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  };
  const onInstalled = () => {
    deferred = null;
    emit();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/**
 * Registers the service worker (public/sw.js) in production builds. In development it removes one
 * a production run left on this origin: it would serve stale scripts and break hot reloading.
 */
export function AppShellSetup() {
  useEffect(() => {
    const stop = captureInstallPrompt();
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
      } else {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(registrations.filter((r) => r.active?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister())),
          )
          .catch(() => {});
      }
    }
    return stop;
  }, []);
  return null;
}

function useInstallPrompt() {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    () => deferred,
    () => null,
  );
}

/** "Install app" in the workspace menu, shown only while the browser offers installing. */
export function InstallAppMenuItem({ onDone }: { onDone: () => void }) {
  const t = useTranslations("offline");
  const prompt = useInstallPrompt();
  if (!prompt) return null;
  return (
    <MenuItem
      icon={<MonitorDown className="h-4 w-4" />}
      onClick={() => {
        onDone();
        void prompt.prompt().catch(() => {});
        void prompt.userChoice.then(() => {
          // A prompt can be used once; the browser offers a new one later if it was dismissed.
          deferred = null;
          emit();
        });
      }}
    >
      {t("installApp")}
    </MenuItem>
  );
}
