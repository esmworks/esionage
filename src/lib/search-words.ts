// Search terms for "any of these words", which the AI chat uses: it searches with whole questions
// ("Kart ekstreleri ne durumda?"), where requiring every word finds nothing.

/** Question words and fillers that would match almost any page (Turkish and English). */
const STOPWORDS = new Set(
  (
    "acaba ama bana beni benim bir biraz bize bizim bu bunu bunun çok daha diye gibi hangi hangisi hem için ile ise kaç kadar " +
    "mı mi mu mü nasıl ne neden nedir nerede neler niye olan olarak oldu olur sadece şu var veya yok " +
    "about and are can did does for from has have how into its many much should that the their them there " +
    "these this was what when where which who why will with would you your"
  ).split(" "),
);

/** Longer words are cut to this many letters and matched as prefixes (a rough stem for suffixes). */
const STEM = 5;
const STEM_FROM = 7;
const MAX_TERMS = 12;

/**
 * The words of `query` worth searching for: letters and digits only (so nothing else reaches the
 * text-search query), at least 3 characters, no stopwords, each once, long ones cut to their first
 * five letters ("ekstreleri" → "ekstr", matching "ekstresi" too). Case is left to the database, so
 * Turkish İ and I are lowered there the same way as the text. Empty when no word is left.
 */
export function anyWordTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of query.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const letters = Array.from(word);
    if (letters.length < 3) continue;
    const key = word.toLocaleLowerCase("tr");
    if (STOPWORDS.has(key) || STOPWORDS.has(word.toLowerCase())) continue;
    const term = letters.length >= STEM_FROM ? letters.slice(0, STEM).join("") : word;
    const termKey = term.toLocaleLowerCase("tr");
    if (seen.has(termKey)) continue;
    seen.add(termKey);
    terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** A `to_tsquery` text matching pages with any of the terms, as prefixes. */
export function anyWordTsQuery(terms: string[]): string {
  return terms.map((t) => `${t}:*`).join(" | ");
}
