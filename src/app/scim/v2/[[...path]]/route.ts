import { handleScimRequest } from "@/server/scim";

/** SCIM 2.0 provisioning (see src/server/scim.ts): every /scim/v2 path goes through one handler. */
function handle(request: Request) {
  return handleScimRequest(request);
}

export const dynamic = "force-dynamic";

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
