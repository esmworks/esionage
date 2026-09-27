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
import publish from "./tr/publish.json";
import form from "./tr/form.json";
import imports from "./tr/import.json";
import security from "./tr/security.json";
import apiTokens from "./tr/apiTokens.json";
import account from "./tr/account.json";
import offline from "./tr/offline.json";

import type en from "./en";

// Same shape as English; `pnpm typecheck` and messages.test.ts catch missing keys.
const messages: typeof en = { common, auth, consent, sidebar, page, home, settings, database, invite, join, publish, form, import: imports, security, apiTokens, account, offline };

export default messages;
