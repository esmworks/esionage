import { describe, expect, it } from "vitest";
import { requestSession } from "./request-session";

describe("requestSession", () => {
  it("is null outside a Next request (the collab server, scripts), so access checks there skip the policy", async () => {
    expect(await requestSession()).toBeNull();
  });
});
