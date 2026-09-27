import common from "./tr/common.json";
import auth from "./tr/auth.json";
import consent from "./tr/consent.json";
import sidebar from "./tr/sidebar.json";
import page from "./tr/page.json";
import home from "./tr/home.json";
import settings from "./tr/settings.json";
import database from "./tr/database.json";
import invite from "./tr/invite.json";
import join from "./tr/join.json";

import type en from "./en";

// Same shape as English; `pnpm typecheck` and messages.test.ts catch missing keys.
const messages: typeof en = { common, auth, consent, sidebar, page, home, settings, database, invite, join };

export default messages;
