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

  it("gives others nothing in closed and private teamspaces", () => {
    expect(everyoneFloor("full", { access: "closed", members }, "out")).toBe("none");
    expect(everyoneFloor("full", { access: "private", members }, "out")).toBe("none");
  });
});
