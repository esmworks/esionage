import { getTranslations } from "next-intl/server";
import type { DatabaseSeedNames } from "@/server/pages";

/** Starter property, option and view names for a new database, in the user's language. */
export async function databaseSeedNames(): Promise<DatabaseSeedNames> {
  const t = await getTranslations("database");
  return {
    status: t("page.defaultGroupProperty"),
    notStarted: t("page.defaultGroupOptions.notStarted"),
    inProgress: t("page.defaultGroupOptions.inProgress"),
    done: t("page.defaultGroupOptions.done"),
    tags: t("page.defaultTagsProperty"),
    table: t("views.table"),
  };
}
