import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_SETTINGS } from "@/db/schema";
import {
  daysUntil,
  historyCutoffs,
  HISTORY_RETENTION,
  retentionJobEnabled,
  trashDeletionDate,
  TRASH_RETENTION_CHOICES,
} from "./retention";

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe("trash retention", () => {
  it("offers the default and keeping forever", () => {
    expect(TRASH_RETENTION_CHOICES).toContain(DEFAULT_WORKSPACE_SETTINGS.trashRetentionDays);
    expect(TRASH_RETENTION_CHOICES).toContain(0);
    expect(DEFAULT_WORKSPACE_SETTINGS.trashRetentionDays).toBe(30);
  });

  it("deletes a page the set number of days after it was trashed", () => {
    expect(trashDeletionDate(at("2026-01-01T10:00:00Z"), 30)).toEqual(at("2026-01-31T10:00:00Z"));
  });

  it("keeps pages forever at 0", () => {
    expect(trashDeletionDate(at("2026-01-01T10:00:00Z"), 0)).toBeNull();
  });

  it("treats a missing or broken setting as keeping, never as deleting everything", () => {
    expect(trashDeletionDate(at("2026-01-01T10:00:00Z"), Number.NaN)).toBeNull();
    expect(trashDeletionDate(at("2026-01-01T10:00:00Z"), -5)).toBeNull();
  });

  it("counts days left rounded up, and zero once due", () => {
    const deletesAt = at("2026-01-31T10:00:00Z");
    expect(daysUntil(deletesAt, at("2026-01-01T10:00:00Z"))).toBe(30);
    expect(daysUntil(deletesAt, at("2026-01-01T11:00:00Z"))).toBe(30);
    expect(daysUntil(deletesAt, at("2026-01-30T11:00:00Z"))).toBe(1);
    expect(daysUntil(deletesAt, at("2026-01-31T10:00:00Z"))).toBe(0);
    expect(daysUntil(deletesAt, at("2026-02-05T00:00:00Z"))).toBe(0);
  });
});

describe("history retention", () => {
  it("keeps restore points and saved versions longer than the rest", () => {
    const now = at("2026-06-01T00:00:00Z");
    const { regular, kept } = historyCutoffs(now);
    expect(now.getTime() - regular.getTime()).toBe(HISTORY_RETENTION.maxAgeDays * DAY);
    expect(now.getTime() - kept.getTime()).toBe(HISTORY_RETENTION.keptAgeDays * DAY);
    expect(kept.getTime()).toBeLessThan(regular.getTime());
    expect(HISTORY_RETENTION.keptReasons).toEqual(["before_restore", "manual"]);
  });
});

describe("retention job", () => {
  it("runs on production servers and not on dev servers, unless RETENTION_JOB says otherwise", () => {
    expect(retentionJobEnabled(undefined, false)).toBe(true);
    expect(retentionJobEnabled(undefined, true)).toBe(false);
    expect(retentionJobEnabled("on", true)).toBe(true);
    expect(retentionJobEnabled("off", false)).toBe(false);
  });
});
