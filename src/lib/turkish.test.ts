import { describe, expect, it } from "vitest";
import { turkishGenitive } from "./turkish";

describe("turkishGenitive", () => {
  it.each([
    ["Erhan", "Erhan'ın"],
    ["Ayşe", "Ayşe'nin"],
    ["Mehmet", "Mehmet'in"],
    ["Onur", "Onur'un"],
    ["Türkü", "Türkü'nün"],
    ["Gökçe", "Gökçe'nin"],
    ["Ömür", "Ömür'ün"],
    ["John", "John'un"],
    ["Ali", "Ali'nin"],
    ["Ilgaz", "Ilgaz'ın"],
  ])("%s → %s", (name, expected) => {
    expect(turkishGenitive(name)).toBe(expected);
  });
});
