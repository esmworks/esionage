import { describe, expect, it } from "vitest";
import { type DirectoryPerson, matchesPerson } from "./people";

const person: DirectoryPerson = {
  userId: "u",
  name: "Işıl Yıldız",
  email: "iy@example.test",
  image: null,
  role: "member",
  teamspaces: [{ id: "t", name: "Engineering", icon: null }],
  groups: [{ id: "g", name: "Design" }],
  recentPages: [],
};

describe("matchesPerson", () => {
  it("matches everyone on an empty query", () => {
    expect(matchesPerson(person, "")).toBe(true);
    expect(matchesPerson(person, "   ")).toBe(true);
  });

  it("finds a person by name or email, whatever the case", () => {
    expect(matchesPerson(person, "yıldız")).toBe(true);
    expect(matchesPerson(person, "EXAMPLE.test")).toBe(true);
    expect(matchesPerson(person, "someone else")).toBe(false);
  });

  it("treats the dotted and dotless i alike", () => {
    expect(matchesPerson(person, "ışil")).toBe(true);
    expect(matchesPerson(person, "yildiz")).toBe(true);
    expect(matchesPerson(person, "IŞIL")).toBe(true);
  });

  it("finds a person by their teamspaces and groups", () => {
    expect(matchesPerson(person, "engineer")).toBe(true);
    expect(matchesPerson(person, "design")).toBe(true);
  });

  it("needs every word to match somewhere", () => {
    expect(matchesPerson(person, "design ışıl")).toBe(true);
    expect(matchesPerson(person, "design marketing")).toBe(false);
  });
});
