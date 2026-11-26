// Ross Note's own spelling check (British English), the same dictionary the laptop uses (Debian's
// hunspell-en-gb), as a plain list of every word form: quick to load and to look up on a tablet.
// Your own words live in "Ross Note dictionary.txt" in the RossNotes folder, shared with the laptop.

// (RossDraft 1.15.0) other languages too: each its own list, loaded the first time it's wanted
// (vendor/dict/<code>.words / .common, made by tools/make_dicts.py from LibreOffice's Hunspell dictionaries)
export const LANGS = [["en-GB", "English (UK)"], ["en-US", "English (US)"], ["fr", "French"], ["es", "Spanish"], ["de", "German"],
  ["pt-BR", "Portuguese (Brazil)"], ["it", "Italian"], ["nl", "Dutch"]];
// a Word language tag ("fr-FR", "es-419", "en-AU") to the list that checks it (null: none here: not checked)
export function dictFor(tag) {
  if (!tag) return "en-GB";
  const t = tag.toLowerCase();
  if (t === "zxx") return null;
  if (t === "en-us") return "en-US";
  if (t.startsWith("en")) return "en-GB";
  for (const [c] of LANGS) if (t === c.toLowerCase() || t.split("-")[0] === c.split("-")[0]) return c;
  return null;
}
export const langName = (tag) => { if ((tag || "").toLowerCase() === "zxx") return "Not checked"; const c = dictFor(tag); const x = LANGS.find((l) => l[0] === c); return x ? x[1] : tag; };
const L = new Map();       // code -> { words: Set, rank: Map }
let words = null;          // English (UK)'s: every word form
let rank = null;           // how common (0 = commonest)
const own = new Set();     // the dictionary file's words
const ignored = new Set(); // "Ignore" (until Ross Note is closed)
const loading = new Map();
let base0 = "vendor/dict/";

export const ready = (code = "en-GB") => L.has(code);
export const loaded = () => [...L.keys()];

async function fetchList(base, code) {
  const [w, c] = await Promise.all([
    fetch(base + code + ".words").then((r) => { if (!r.ok) throw new Error("the dictionary couldn't be loaded"); return r.text(); }),
    fetch(base + code + ".common").then((r) => (r.ok ? r.text() : "")).catch(() => ""),
  ]);
  const set = new Set();
  let prev = "";
  let i = 0;
  const n = w.length;
  while (i < n) {
    let j = w.indexOf("\n", i);
    if (j < 0) j = n;
    if (j > i) {
      const keep = w.charCodeAt(i) - 48;
      prev = prev.slice(0, keep) + w.slice(i + 1, j);
      set.add(prev);
    }
    i = j + 1;
  }
  const rk = new Map();
  c.split("\n").forEach((x, k) => { if (x) rk.set(x, k); });
  return { words: set, rank: rk };
}

export function load(base = base0, code = "en-GB") {
  base0 = base;
  if (loading.has(code)) return loading.get(code);
  const p = (async () => {
    const d = await fetchList(base, code);
    L.set(code, d);
    if (code === "en-GB") { words = d.words; rank = d.rank; }
    return true;
  })();
  loading.set(code, p);
  p.catch(() => { loading.delete(code); });
  return p;
}

const norm = (w) => w.replace(/[’‘]/g, "'");

// the words of a line of text: [start, end, word]
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const SKIP = /(?:https?:\/\/|www\.|mailto:)\S+|\S+@\S+\.\S+/g;
export function wordsIn(text) {
  const clean = text.replace(SKIP, (m) => " ".repeat(m.length));
  const out = [];
  for (const m of clean.matchAll(WORD)) out.push([m.index, m.index + m[0].length, m[0]]);
  return out;
}

function known(w, words) {
  if (words.has(w) || own.has(w)) return true;
  const lower = w.toLowerCase();
  if (own.has(lower)) return true;
  // "Colour" at the start of a sentence; "COLOUR" in capitals
  if (w[0] !== lower[0] && w.slice(1) === lower.slice(1) && words.has(lower)) return true;
  if (w === w.toUpperCase()) {
    if (words.has(lower)) return true;
    const cap = lower[0].toUpperCase() + lower.slice(1);
    if (words.has(cap)) return true;
  }
  return false;
}

// French and Italian: l'homme, qu'il, dell'anno — the word after the elided one
const ELIDE = { fr: /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu|presqu|quelqu)'(.+)$/i,
  it: /^(?:l|d|un|dell|all|dall|nell|sull|coll|quell|bell|sant|quest|c|anch|com|dov|nient|tutt)'(.+)$/i };
export function ok(word, code = "en-GB") {
  const d = L.get(code);
  if (!d) return true;
  const w = norm(word);
  if (w.length < 2 || ignored.has(w)) return true;
  if (/^[\p{Lu}]+$/u.test(w) && w.length <= 5) return true;    // initials, acronyms: BBC, NHS
  if (known(w, d.words)) return true;
  // a possessive or a contraction of a known word: Ross's, Jacob's
  const m = /^(.+)'s$/i.exec(w);
  if (m && code.startsWith("en") && known(m[1], d.words)) return true;
  const e = ELIDE[code] && ELIDE[code].exec(w);
  if (e && (known(e[1], d.words) || ok(e[1], code))) return true;
  // German and Dutch run words together: two known words, each of three letters or more
  if ((code === "de" || code === "nl") && w.length > 7) {
    const lw = w.toLowerCase();
    for (let i = 3; i <= lw.length - 3; i++) {
      const a = lw.slice(0, i), b = lw.slice(i), b2 = b[0].toUpperCase() + b.slice(1);
      const a1 = a[0].toUpperCase() + a.slice(1);
      const okA = d.words.has(a) || d.words.has(a1) || (a.endsWith("s") && (d.words.has(a.slice(0, -1)) || d.words.has(a1.slice(0, -1))));
      if (okA && (d.words.has(b) || d.words.has(b2))) return true;
    }
  }
  return false;
}

// spelling suggestions, likeliest first
export function suggest(word, max = 6, code = "en-GB") {
  const d = L.get(code);
  if (!d) return [];
  const words = d.words, rank = d.rank;
  const w = norm(word);
  const lower = w.toLowerCase();
  const isCap = w[0] !== lower[0] && w.slice(1) === lower.slice(1);
  const isUpper = w.length > 1 && w === w.toUpperCase();
  const shape = (s) => (isUpper ? s.toUpperCase() : isCap ? s[0].toUpperCase() + s.slice(1) : s);
  const letters = "abcdefghijklmnopqrstuvwxyz'" + ({ fr: "éèêàâçùûôîëïü", es: "áéíóúñü", de: "äöüß", "pt-BR": "áâãàçéêíóôõú", it: "àèéìòù", nl: "ëéïö" }[code] || "");
  const edits = (s) => {
    const out = new Set();
    for (let i = 0; i <= s.length; i++) {
      const a = s.slice(0, i), b = s.slice(i);
      if (b) out.add(a + b.slice(1));                                    // a letter too many
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));            // two swapped
      for (const c of letters) {
        if (b) out.add(a + c + b.slice(1));                              // a wrong letter
        out.add(a + c + b);                                              // a letter missing
      }
    }
    // two words run together
    for (let i = 1; i < s.length; i++) out.add(s.slice(0, i) + " " + s.slice(i));
    out.delete(s);
    return out;
  };
  const real = (s) => {
    if (s.includes(" ")) return s.split(" ").every((p) => p.length > 1 && (words.has(p) || own.has(p)) || p === "a" || p === "I");
    return words.has(s) || own.has(s) || words.has(s[0].toUpperCase() + s.slice(1));
  };
  const asIn = (s) => (s.includes(" ") || words.has(s) || own.has(s) ? s : s[0].toUpperCase() + s.slice(1));
  const rankOf = (s) => (rank.has(s) ? rank.get(s) : rank.has(s.toLowerCase()) ? rank.get(s.toLowerCase()) : 40000);
  const score = (s, d) => {
    // two words run together ("alot"): as likely as its rarer word, a little less than a one-word fix
    if (s.includes(" ")) return d * 100000 + Math.max(...s.split(" ").map(rankOf)) + 5000;
    let v = d * 100000 + rankOf(s);
    if (s[0] !== lower[0]) v += 20000;                                  // people rarely get the first letter wrong
    return v;
  };
  const found = new Map();
  const one = edits(lower);
  for (const s of one) if (real(s)) found.set(asIn(s), score(s, 1));
  if (found.size < max && lower.length > 2 && lower.length < 16) {
    for (const s1 of one) {
      if (s1.includes(" ")) continue;
      for (const s of edits(s1)) {
        if (s.includes(" ") || found.has(s) || s === lower) continue;
        if (real(s)) found.set(asIn(s), Math.min(found.get(asIn(s)) ?? Infinity, score(s, 2)));
      }
    }
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([s]) => (/^[\p{Lu}]/u.test(s) ? s : shape(s)));
}

// your own words (from the dictionary file)
export function setOwn(list) {
  own.clear();
  for (const x of list) { const w = norm(x.trim()); if (w) own.add(w); }
}
export const ownWords = () => [...own].sort((a, b) => a.localeCompare(b));
export function addOwn(word) { own.add(norm(word)); }
export function ignore(word) { ignored.add(norm(word)); }

// ---- (RossDraft 1.15.0) the thesaurus: English (vendor/thes/en.thes, from LibreOffice's, made from WordNet),
// loaded the first time it's wanted
let TH = null, thLoading = null;
export function loadThesaurus(base = "vendor/thes/") {
  if (thLoading) return thLoading;
  thLoading = (async () => {
    const r = await fetch(base + "en.thes");
    if (!r.ok) throw new Error("the thesaurus couldn't be loaded");
    const t = await r.text();
    const cut = t.indexOf("\n#\n");
    const meanings = t.slice(0, cut).split("\n");
    const index = new Map();
    for (const ln of t.slice(cut + 3).split("\n")) {
      const k = ln.indexOf("\t");
      if (k > 0) index.set(ln.slice(0, k), ln.slice(k + 1));
    }
    TH = { meanings, index };
    return true;
  })();
  thLoading.catch(() => { thLoading = null; });
  return thLoading;
}
export const thesaurusReady = () => !!TH;
// British spellings to the American ones the thesaurus has, and back
const US = [[/our$/, "or"], [/our(s|ed|ing|ful|less|able)$/, "or$1"], [/is(e|es|ed|ing|ation|ations)$/, "iz$1"], [/ys(e|es|ed|ing)$/, "yz$1"],
  [/tre(s?)$/, "ter$1"], [/ogue(s?)$/, "og$1"], [/ence(s?)$/, "ense$1"], [/ll(ed|ing|er|ers)$/, "l$1"], [/ae/, "e"], [/oe/, "e"]];
function variants(w) {
  const out = [w];
  const lower = w.toLowerCase();
  if (lower !== w) out.push(lower);
  for (const [re, to] of US) if (re.test(lower)) out.push(lower.replace(re, to));
  // the word's own form: runs -> run, happier -> happy, walked -> walk, making -> make
  const base = [[/ies$/, "y"], [/ves$/, "f"], [/es$/, ""], [/s$/, ""], [/ied$/, "y"], [/ed$/, ""], [/ed$/, "e"], [/ing$/, ""], [/ing$/, "e"],
    [/(.)\1ing$/, "$1"], [/(.)\1ed$/, "$1"], [/ier$/, "y"], [/iest$/, "y"], [/er$/, ""], [/est$/, ""], [/ly$/, ""], [/ily$/, "y"]];
  for (const v of out.slice()) for (const [re, to] of base) if (re.test(v) && v.length > 3) out.push(v.replace(re, to));
  return [...new Set(out)];
}
const POSN = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
// a word's meanings: [{ pos, words: [the others], broader: [], similar: [], related: [], opposite: [] }], and the
// form found (the word itself, or its own form)
export function lookUp(word) {
  if (!TH) return null;
  const w = norm(word).trim();
  for (const v of variants(w)) {
    const ids = TH.index.get(v);
    if (!ids) continue;
    const out = [];
    for (const id of ids.split(",")) {
      const parts = TH.meanings[+id].split("|");
      const m = { pos: POSN[parts[0]] || "", words: [], broader: [], similar: [], related: [], opposite: [] };
      for (const x of parts.slice(1)) {
        const k = x.indexOf("~");
        const t = k < 0 ? x : x.slice(0, k);
        if (t.toLowerCase() === v.toLowerCase()) continue;
        ({ "": m.words, g: m.broader, s: m.similar, r: m.related, a: m.opposite })[k < 0 ? "" : x.slice(k + 1)].push(t);
      }
      if (m.words.length || m.broader.length || m.similar.length || m.related.length || m.opposite.length) out.push(m);
    }
    return { found: v, meanings: out };
  }
  return { found: null, meanings: [] };
}
// an American spelling as British, where the British one is a word and the American isn't (in English (UK))
export function british(w) {
  const d = L.get("en-GB");
  if (!d) return w;
  if (/[\s-]/.test(w)) return w.split(/([\s-])/).map((x) => (/^[\s-]$/.test(x) || !x ? x : british(x))).join("");
  if (d.words.has(w)) return w;
  // one or two changes, anywhere in the word: or -> our, iz -> is, yz -> ys, er -> re (centre), l -> ll, og -> ogue,
  // ense -> ence (colorization -> colourisation, colorless -> colourless, traveled -> travelled)
  const SUBS = [["or", "our"], ["iz", "is"], ["yz", "ys"], ["ter", "tre"], ["l", "ll"], ["og", "ogue"], ["ense", "ence"]];
  const step = (x) => {
    const out = [];
    for (const [a, b] of SUBS) for (let i = x.indexOf(a); i >= 0; i = x.indexOf(a, i + 1)) out.push(x.slice(0, i) + b + x.slice(i + a.length));
    return out;
  };
  const one = step(w);
  for (const c of one) if (d.words.has(c)) return c;
  for (const c1 of one) for (const c of step(c1)) if (d.words.has(c)) return c;
  return w;
}
