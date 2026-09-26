const BACK_UNROUNDED = "aı";
const FRONT_UNROUNDED = "ei";
const BACK_ROUNDED = "ou";
const FRONT_ROUNDED = "öü";
const VOWELS = BACK_UNROUNDED + FRONT_UNROUNDED + BACK_ROUNDED + FRONT_ROUNDED;

/**
 * Turkish genitive for a proper name, with the apostrophe: "Erhan'ın", "Ayşe'nin", "John'un".
 * Follows vowel harmony on the last vowel; a buffer "n" is added after a final vowel.
 */
export function turkishGenitive(name: string): string {
  const word = name.trim();
  const lower = word.toLocaleLowerCase("tr");
  const vowels = [...lower].filter((ch) => VOWELS.includes(ch));
  const last = vowels.at(-1);
  const vowel = !last
    ? "i"
    : BACK_UNROUNDED.includes(last)
      ? "ı"
      : FRONT_UNROUNDED.includes(last)
        ? "i"
        : BACK_ROUNDED.includes(last)
          ? "u"
          : "ü";
  const endsWithVowel = VOWELS.includes(lower.at(-1) ?? "");
  return `${word}'${endsWithVowel ? "n" : ""}${vowel}n`;
}
