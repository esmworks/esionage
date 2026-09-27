"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { removeAvatarAction, updateNameAction } from "@/app/actions/account";
import { SettingsRow } from "@/components/settings/section";
import { Button, Input } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { MAX_NAME_LENGTH } from "@/lib/account";
import { AVATAR_SIZE, MAX_AVATAR_BYTES } from "@/lib/avatar";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** The picture cropped to a centered square and scaled to AVATAR_SIZE, as WebP (PNG where the browser can't). */
async function avatarBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await encode("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await encode("image/png");
  if (!blob) throw new Error("could not encode");
  return blob;
}

/** Account > Profile: the picture and the name other people see. */
export function ProfileSettings({ name, image }: { name: string; image: string | null }) {
  const t = useTranslations("account.profile");
  const te = useTranslations("account.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== name && value.trim() !== "";

  async function upload(file: File) {
    setAvatarError(null);
    if (!ACCEPT.split(",").includes(file.type)) return setAvatarError(te("avatarType"));
    setUploading(true);
    try {
      const blob = await avatarBlob(file).catch(() => null);
      if (!blob) return setAvatarError(te("avatarType"));
      if (blob.size > MAX_AVATAR_BYTES) return setAvatarError(te("avatarTooLarge"));
      const res = await fetch("/api/account/avatar", {
        method: "POST",
        headers: { "content-type": blob.type, "x-avatar-upload": "1" },
        body: blob,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return setAvatarError(body?.error ?? tc("genericError"));
      }
      router.refresh();
    } catch {
      setAvatarError(tc("genericError"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <SettingsRow
        title={t("picture")}
        description={avatarError ? <span className="text-danger">{avatarError}</span> : t("pictureHelp")}
        control={
          <>
            <UserAvatar name={name} image={image} size="xl" />
            <div className="flex flex-col gap-1.5">
              <Button size="sm" disabled={uploading || pending} onClick={() => input.current?.click()}>
                {uploading ? t("uploading") : image ? t("changePicture") : t("uploadPicture")}
              </Button>
              {image && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={uploading || pending}
                  onClick={() =>
                    startTransition(async () => {
                      setAvatarError(null);
                      const result = await removeAvatarAction().catch(() => null);
                      if (!result?.ok) setAvatarError(result?.error ?? tc("genericError"));
                    })
                  }
                >
                  {t("removePicture")}
                </Button>
              )}
            </div>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              aria-label={t("uploadPicture")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </>
        }
      />
      <SettingsRow
        title={t("name")}
        htmlFor="account-name"
        description={nameError ? <span className="text-danger">{nameError}</span> : t("nameHelp")}
        control={
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!dirty) return;
              setNameError(null);
              setSaved(false);
              startTransition(async () => {
                const result = await updateNameAction(value).catch(() => null);
                if (!result?.ok) return setNameError(result?.error ?? tc("genericError"));
                setValue(result.data);
                setSaved(true);
              });
            }}
          >
            <Input
              id="account-name"
              value={value}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="name"
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              className="w-56"
            />
            <Button type="submit" variant="primary" disabled={!dirty || pending}>
              {pending && dirty ? tc("saving") : saved && !dirty ? tc("saved") : tc("save")}
            </Button>
          </form>
        }
      />
    </>
  );
}
