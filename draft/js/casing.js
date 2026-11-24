// Change Case (Shift+F3, as in Word), Ross Writer's casing.py: lowercase, UPPERCASE, Title Case, Sentence case
// and tOGGLE cASE, worked out over the whole selection but applied letter by letter, so the length never changes
// and formatting stays put.
export const MODES = ["lower", "upper", "title", "sentence", "toggle"];
export const LABELS = { lower: "lowercase", upper: "UPPERCASE", title: "Title Case", sentence: "Sentence case", toggle: "tOGGLE cASE" };
const OBJ = "￼";
const ENDS = ".!?";
const BREAKS = "  \n";
const CLOSERS = "\"'”’)]";
const isAlpha = (c) => /\p{L}/u.test(c);
const isSpace = (c) => /\s/.test(c);
const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();
// one character upper- or lower-cased, kept one character long (ß stays ß, not SS)
function one(ch, upper) {
  const out = upper ? ch.toUpperCase() : ch.toLowerCase();
  return out.length === 1 ? out : ch;
}

export function convert(text, mode) {
  const chars = [...text];
  if (mode === "lower") return chars.map((c) => one(c, false)).join("");
  if (mode === "upper") return chars.map((c) => one(c, true)).join("");
  if (mode === "toggle") return chars.map((c) => (isAlpha(c) ? one(c, !isUpper(c)) : c)).join("");
  const out = [];
  if (mode === "title") {
    let start = true;
    chars.forEach((c, i) => {
      if (isAlpha(c)) {
        const prev = i ? chars[i - 1] : " ";
        // after an apostrophe inside a word (don't, Mother's) stay lower
        if (start && !("'’".includes(prev) && i > 1 && isAlpha(chars[i - 2]))) out.push(one(c, true));
        else out.push(one(c, false));
        start = false;
      } else {
        out.push(c);
        if (isSpace(c) || BREAKS.includes(c) || "-–—/(\"“[".includes(c) || c === OBJ) start = true;
        else if ("'‘".includes(c) && (i === 0 || !isAlpha(chars[i - 1]))) start = true;
        else if (/\d/.test(c)) start = false;
      }
    });
    return out.join("");
  }
  if (mode === "sentence") {
    let start = true, pendingEnd = false;
    for (const c of chars) {
      if (isAlpha(c)) {
        out.push(one(c, start));
        start = false;
        pendingEnd = false;
      } else {
        out.push(c);
        if (BREAKS.includes(c)) start = true;
        else if (ENDS.includes(c)) pendingEnd = true;
        else if (pendingEnd && isSpace(c)) start = true;
        else if (pendingEnd && CLOSERS.includes(c)) { /* still waiting */ }
        else if (!isSpace(c)) pendingEnd = false;
      }
    }
    // a lone "i" is always "I" in English
    return out.join("").replace(/(?<![\p{L}\p{N}_'’])i(?=[\s.,;:!?'’]|$)/gu, "I");
  }
  return text;
}

// what Shift+F3 does next, judged from the text as it is now: lowercase → UPPERCASE → Title Case → lowercase
// (Word's cycle); anything mixed goes to lowercase first, unless it's already sentence-like (then UPPERCASE)
export function nextMode(text) {
  const letters = [...text].filter(isAlpha);
  if (!letters.length) return null;
  if (text === convert(text, "upper")) return "title";
  if (text === convert(text, "title") && letters.some(isUpper)) return "lower";
  if (text === convert(text, "lower")) return "upper";
  if (text === convert(text, "sentence")) return "upper";
  return "lower";
}
