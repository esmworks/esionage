import { handleApiRequest } from "@/server/api";

/** The REST API (see src/server/api): every /api/v1 path goes through one handler and route table. */
function handle(request: Request) {
  return handleApiRequest(request);
}

export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as PUT, handle as DELETE, handle as OPTIONS };
