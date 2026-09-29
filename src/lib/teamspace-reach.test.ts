import { describe, expect, it } from "vitest";
import { everyoneFloor } from "./teamspace-reach";

describe("everyoneFloor", () => {
  const members = new Set(["in"]);

  it("gives the whole level on private pages", () => {
    expect(everyoneFloor("edit", null, "anyone")).toBe("edit");
    expect(everyoneFloor("none", null, "anyone")).toBe("none");
  });

  it("gives the whole level to everyone in a default teamspace and to members of others", () => {
    expect(everyoneFloor("full", { access: "default", members: new Set() }, "anyone")).toBe("full");
    for (const access of ["open", "closed", "private"] as const) {
      expect(everyoneFloor("full", { access, members }, "in")).toBe("full");
    }
  });

  it("caps others at comment in an open teamspace", () => {
    expect(everyoneFloor("full", { access: "open", members }, "out")).toBe("comment");
    expect(everyoneFloor("view", { access: "open", members }, "out")).toBe("view");
    expect(everyoneFloor("none", { access: "open", members }, "out")).toBe("none");
  });

  it("gives the teamspace's owners and the workspace's owners full access where the teamspace decides", () => {
    const reach = { access: "closed" as const, members: new Set(["in", "boss"]), owners: new Set(["boss"]), memberLevel: "edit" as const };
    expect(everyoneFloor("edit", reach, "in", { fromTeamspace: true })).toBe("edit");
    expect(everyoneFloor("edit", reach, "boss", { fromTeamspace: true })).toBe("full");
    expect(everyoneFloor("edit", reach, "in", { fromTeamspace: true, workspaceOwner: true })).toBe("full");
    // A page's own entry for everyone holds for owners too, and owners outside it get nothing.
    expect(everyoneFloor("view", reach, "boss")).toBe("view");
    expect(everyoneFloor("edit", reach, "out", { fromTeamspace: true, workspaceOwner: true })).toBe("none");
  });

  it("gives others nothing in closed and private teamspaces", () => {
    expect(everyoneFloor("full", { access: "closed", members }, "out")).toBe("none");
    expect(everyoneFloor("full", { access: "private", members }, "out")).toBe("none");
  });
});
