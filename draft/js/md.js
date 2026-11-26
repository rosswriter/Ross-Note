// Ross Note's Markdown, read and written exactly as the desktop program does
// (src/ross_note/md.py), so a note can go back and forth between the laptop
// and the tablet without changing.
//
// A note is a list of lines. Each line is one paragraph:
//   { kind: null | "h1".."h6" | "ul" | "ol" | "quote",
//     mark: the list marker from the file when it isn't the plain one ("ul:* ", "ol:  \u0000) "),
//     runs: [{ t, f: Set of b i u s h, href, img: {src, size, orig} }],
//     raw: the line as it was (a line Ross Note can't write back exactly; kept as it was),
//     code: true for code, tables and rules (shown in monospace, always written as typed) }

export const OBJ = "￼";

// RossDraft 1.8.0: tables, as Ross Writer shows them: a table is one line { kind: "table", cells: rows of cells,
// each cell its paragraphs ({ kind: null, runs }), noLines, equal, runs: [] }, written as a Markdown pipe table
// (a cell's paragraphs joined with <br>, "|" in the words as "\|"), with "<!-- table: nolines equal -->" on the
// line before when it has those. Only where setTables(true) (RossDraft): elsewhere such lines stay as written.
let TABLES = false;
export function setTables(on) { TABLES = !!on; }
export function tablesOn() { return TABLES; }
const TROW_RE = /^\|.*\|$/;
const TSEP_RE = /^\|(?: ?:?-{3,}:? ?\|)+$/;
const TFLAGS_RE = /^<!-- table:((?: (?:nolines|equal|w=\d+(?:,\d+)*))+) -->$/;
function splitRow(s) {
  const inner = s.slice(1, -1);
  const out = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") { cur += "\\|"; i++; continue; }
    if (inner[i] === "|") { out.push(cur); cur = ""; continue; }
    cur += inner[i];
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
function cellParas(text) {
  return text.split("<br>").map((p) => ({ kind: null, runs: inlineRuns(p.split("\\|").join("|")) }));
}
// lines[i…] as a table line, and how many text lines it took; null when they aren't one written back exactly
function tableAt(lines, i) {
  let flags = "", at = i;
  const fm = TFLAGS_RE.exec(lines[i]);
  if (fm) { flags = fm[1]; at = i + 1; }
  if (!(at + 1 < lines.length && TROW_RE.test(lines[at]) && TSEP_RE.test(lines[at + 1]))) return null;
  const rows = [splitRow(lines[at])];
  let j = at + 2;
  while (j < lines.length && TROW_RE.test(lines[j]) && !TSEP_RE.test(lines[j])) { rows.push(splitRow(lines[j])); j++; }
  const w = Math.max(...rows.map((r) => r.length));
  const ln = { kind: "table", runs: [], cells: rows.map((r) => Array.from({ length: w }, (_, k) => cellParas(r[k] || ""))) };
  if (/nolines/.test(flags)) ln.noLines = true;
  if (/equal/.test(flags)) ln.equal = true;
  const wm = / w=([\d,]+)/.exec(flags);
  if (wm) ln.widths = wm[1].split(",").map(Number);       // (1.8.1) the columns' widths (Word's, twentieths of a point)
  if (tableMarkdown(ln) !== lines.slice(i, j).join("\n")) return null;
  return [ln, j - i];
}
function tableMarkdown(ln, opts = {}) {
  const rows = ln.cells || [];
  const w = Math.max(1, ...rows.map((r) => r.length));
  const cell = (paras) => (paras || []).map((p) => lineMarkdown({ kind: null, runs: p.runs || [] }, null, opts)
    .split("|").join("\\|").replace(/^\s+|\s+$/g, "")).join("<br>");
  const out = [];
  const flags = [ln.noLines ? "nolines" : "", ln.equal ? "equal" : "",
    ln.widths && ln.widths.length === w ? "w=" + ln.widths.map((x) => Math.round(x)).join(",") : ""].filter(Boolean);
  if (flags.length) out.push("<!-- table: " + flags.join(" ") + " -->");
  rows.forEach((r, k) => {
    out.push("| " + Array.from({ length: w }, (_, c) => cell(r[c])).join(" | ") + " |");
    if (k === 0) out.push("|" + Array(w).fill(" --- ").join("|") + "|");
  });
  return out.join("\n");
}
export function tableText(ln) {
  return (ln.cells || []).map((r) => r.map((c) => c.map((p) => (p.runs || []).map((x) => x.t || "").join("")).join(" ")).join(" ")).join(" ");
}
const ESC_CHARS = "\\*_~=<`#";
const URL_RE = /(?:https?|file|ftp):\/\/[^\s<>\]\["]+|www\.[^\s<>\]\["]+\.[^\s<>\]\["]+|mailto:[^\s<>]+/y;
const DEST = String.raw`((?:[^()\s]|\([^()\s]*\))+)`;      // balanced ( ) in a name: "photo (2).jpg"
const IMG_RE = new RegExp(String.raw`!\[([^\]\n]*)\]\(` + DEST + String.raw`\)`, "y");
const LINK_RE = new RegExp(String.raw`\[([^\]\n]+)\]\(` + DEST + String.raw`\)`, "y");
const LINK_AT = LINK_RE;
const BLOCK_RE = /^(#{1,6})\s+(.*)$|^(\s*)([-*+])(\s+)(.*)$|^(\s*)(\d+)([.)]\s+)(.*)$/s;
const QUOTE_RE = /^>\s?(.*)$/s;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s+\S/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
// a line's alignment (Ross Note 1.6.8 / 1.9.3): <p align="center">…</p>, a heading <h2 align="center">…</h2>
export const ALIGNS = ["center", "right", "justify"];
const ALIGN_RE = /^<(p|h([1-6])) align="(center|right|justify)">(.*)<\/\1>$/s;
// (RossDraft 1.9.0) and its own line spacing, Start on New Page, a page break before it
// (1.12.0) and a tracked change to its end or its settings: tc="i5 f7" (i: its end added, d: taken out, f: settings)
const PARA_RE = /^<(p|h([1-6]))((?: align="(?:center|right|justify)")?(?: ls="\d+(?:\.\d+)?")?(?: newpage)?(?: pagebreak)?(?: tc="[idf]-?\d+(?: [idf]-?\d+)*")?)>(.*)<\/\1>$/s;
const ALNUM = /[\p{L}\p{N}_]/u;     // Python's isalnum() (and "_" never matters here)

function isalnum(c) { return !!c && /[\p{L}\p{N}]/u.test(c); }

function stickyMatch(re, text, i) {
  re.lastIndex = i;
  return re.exec(text);
}

export function urlSpan(text, i) {
  const m = stickyMatch(URL_RE, text, i);
  if (!m) return null;
  let end = i + m[0].length;
  while (end > i && ".,;:!?'’”".includes(text[end - 1])) end -= 1;
  const span = text.slice(i, end);
  if (text[end - 1] === ")" && (span.match(/\(/g) || []).length < (span.match(/\)/g) || []).length) end -= 1;
  return end;
}

export function hrefOf(url) { return url.startsWith("www.") ? "http://" + url : url; }

// ------------------------------------------------------------------ inline
// (1.9.0) the words' own look, as HTML in the Markdown: c:RRGGBB colour, font:Name, sz:N (Word's half-points),
// hc:name (a highlight's colour, with h), sup, sub
const SPAN_RE = /<span style="(color:#[0-9A-Fa-f]{6}|font-family:[^";<>]{1,60}|font-size:\d{1,3}(?:\.5)?pt)">/y;
const MARKC_RE = /<mark class="hl-([A-Za-z]{2,12})">/y;
// (1.12.0) tracked changes from Word: <ins data-tc="5">added</ins>, <del data-tc="6">taken out</del>,
// <span data-tf="7">formatting changed</span>
const TC_RE = /<(ins|del) data-tc="(-?\d+)">|<span data-tf="(-?\d+)">/y;
function spanKey(st) {
  if (st.startsWith("color:#")) return "c:" + st.slice(7).toUpperCase();
  if (st.startsWith("font-family:")) return "font:" + st.slice(12).trim();
  if (st.startsWith("font-size:")) return "sz:" + Math.round(parseFloat(st.slice(10)) * 2);
  return null;
}
function spanOpen(k) {
  if (k.startsWith("c:")) return `<span style="color:#${k.slice(2)}">`;
  if (k.startsWith("font:")) return `<span style="font-family:${k.slice(5)}">`;
  if (k.startsWith("sz:")) return `<span style="font-size:${+k.slice(3) / 2}pt">`;
  return "";
}
export const isLookFlag = (k) => /^(c|font|sz|hc):/.test(k) || k === "sup" || k === "sub";

export function inlineRuns(text) {
  const out = [];
  const state = new Set();
  const spans = [];
  let buf = [];
  let i = 0;
  const n = text.length;
  const flush = () => {
    if (buf.length) { out.push({ t: buf.join(""), f: new Set(state) }); buf = []; }
  };
  const closes = (marker, start) => text.indexOf(marker, start) !== -1;
  while (i < n) {
    const c = text[i];
    if (c === "!" && text[i + 1] === "[") {
      const m = stickyMatch(IMG_RE, text, i);
      if (m) {
        flush();
        out.push({ t: OBJ, f: new Set(), img: { src: m[2], size: m[1], orig: m[0] } });
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const m = stickyMatch(LINK_RE, text, i);
      if (m) {
        flush();
        out.push({ t: m[1], f: new Set(state), href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if ("hfwmH".includes(c) && (i === 0 || !isalnum(text[i - 1]))) {
      const end = urlSpan(text, i);
      if (end) {
        flush();
        const url = text.slice(i, end);
        out.push({ t: url, f: new Set(state), href: hrefOf(url) });
        i = end;
        continue;
      }
    }
    if (c === "\\" && i + 1 < n && (ESC_CHARS + "[").includes(text[i + 1])) {
      buf.push(text[i + 1]);
      i += 2;
      continue;
    }
    // RossDraft 1.9.0: the words' own colour, font, size, highlight colour, superscript and subscript
    if (c === "<") {
      const sp = stickyMatch(SPAN_RE, text, i);
      if (sp && closes("</span>", i + sp[0].length)) {
        const key = spanKey(sp[1]);
        if (key) { flush(); state.add(key); spans.push(key); i += sp[0].length; continue; }
      }
      const tm = stickyMatch(TC_RE, text, i);
      if (tm) {
        const close = tm[1] ? "</" + tm[1] + ">" : "</span>";
        if (closes(close, i + tm[0].length)) {
          const key = tm[1] === "ins" ? "ti:" + tm[2] : tm[1] === "del" ? "td:" + tm[2] : "tf:" + tm[3];
          flush(); state.add(key); spans.push(key); i += tm[0].length; continue;
        }
      }
      if ((text.startsWith("</ins>", i) || text.startsWith("</del>", i)) && spans.length && /^t[id]:/.test(spans[spans.length - 1])) {
        flush(); state.delete(spans.pop()); i += 6; continue;
      }
      if (text.startsWith("</span>", i) && spans.length) { flush(); state.delete(spans.pop()); i += 7; continue; }
      const mk = stickyMatch(MARKC_RE, text, i);
      if (mk && closes("</mark>", i + mk[0].length)) { flush(); state.add("h"); state.add("hc:" + mk[1]); i += mk[0].length; continue; }
      const sv = /^<(\/?)(sup|sub)>/.exec(text.slice(i, i + 6));
      if (sv && (sv[1] ? state.has(sv[2]) : closes("</" + sv[2] + ">", i + 5))) {
        flush();
        if (sv[1]) state.delete(sv[2]); else state.add(sv[2]);
        i += sv[0].length;
        continue;
      }
    }
    const two = text.slice(i, i + 2);
    const low3 = text.slice(i, i + 3).toLowerCase();
    if (low3 === "<u>" && (state.has("u") || closes("</u>", i + 3) || closes("</U>", i + 3))) {
      flush(); state.add("u"); i += 3; continue;
    }
    if (text.slice(i, i + 4).toLowerCase() === "</u>" && state.has("u")) {
      flush(); state.delete("u"); i += 4; continue;
    }
    if (text.slice(i, i + 6).toLowerCase() === "<mark>" && closes("</mark>", i + 6)) {
      flush(); state.add("h"); i += 6; continue;
    }
    if (text.slice(i, i + 7).toLowerCase() === "</mark>" && state.has("h")) {
      flush(); state.delete("h"); for (const k of [...state]) if (k.startsWith("hc:")) state.delete(k); i += 7; continue;
    }
    if (two === "**" || two === "__" || two === "~~" || two === "==") {
      const key = { "**": "b", "__": "b", "~~": "s", "==": "h" }[two];
      if (state.has(key) || closes(two, i + 2)) {
        if (two === "__" && !state.has(key) && i > 0 && isalnum(text[i - 1])) {
          buf.push(two); i += 2; continue;
        }
        flush();
        if (state.has(key)) state.delete(key); else state.add(key);
        i += 2;
        continue;
      }
    }
    if ((c === "*" || c === "_") && text.slice(i, i + 2) !== c + c) {
      if (state.has("i") || closes(c, i + 1)) {
        if (c === "_" && !state.has("i") && i > 0 && isalnum(text[i - 1])) { buf.push(c); i += 1; continue; }
        if (c === "_" && state.has("i") && i + 1 < n && isalnum(text[i + 1])) { buf.push(c); i += 1; continue; }
        flush();
        if (state.has("i")) state.delete("i"); else state.add("i");
        i += 1;
        continue;
      }
    }
    buf.push(c);
    i += 1;
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ pictures
// Python's urllib.parse.quote(rel, safe="/._-~()!,'")
export function quotePath(s) {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9_.\-~/()!,']/.test(ch)) { out += ch; continue; }
    for (const b of new TextEncoder().encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function unquote(s) {
  try { return decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")); } catch (e) { return s; }
}

// a picture's src, from a note in folder `dir` (path parts from the notes folder): parts from the top
export function resolvePicture(src, dir) {
  if (/^[a-z]+:\/\//.test(src) && !src.startsWith("file://")) return null;     // on the web
  let p = unquote(src.startsWith("file://") ? src.slice(7) : src);
  if (p.startsWith("/")) return null;                                         // elsewhere on a computer
  const parts = dir.slice();
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts;
}

export function relativePicture(target, dir) {
  // target, dir: path parts from the notes folder
  let k = 0;
  while (k < dir.length && k < target.length - 1 && dir[k] === target[k]) k++;
  const up = dir.length - k;
  return [...Array(up).fill(".."), ...target.slice(k)].join("/");
}

export function pictureMarkdown(target, size, dir) {
  return "![" + (size || "") + "](" + quotePath(relativePicture(target, dir)) + ")";
}

// ------------------------------------------------------------------ reading a note
export function parse(text) {
  let lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) lines = [""];
  const out = [];
  const lists = new ListState();
  let fence = null;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (TABLES && fence === null && (line[0] === "|" || line.startsWith("<!-- table:"))) {
      const got = tableAt(lines, li);
      if (got) { out.push(got[0]); lists.reset(); li += got[1] - 1; continue; }
    }
    let code = false;
    const fm = FENCE_RE.exec(line);
    if (fence !== null) {
      code = true;
      if (fm && fm[1] === fence) fence = null;
    } else if (fm) {
      fence = fm[1]; code = true;
    } else if (line.trimStart().startsWith("|") ||
               (line.startsWith("    ") || line.startsWith("\t")) && line.trim() && !LIST_ITEM_RE.test(line) ||
               RULE_RE.test(line)) {
      code = true;
    }
    if (code) {
      out.push({ kind: null, runs: [{ t: line, f: new Set() }], raw: line, code: true });
      lists.reset();
      continue;
    }
    const pm = PARA_RE.exec(line);
    const am = pm && pm[3] ? pm : null;
    const ln = am ? parseLine(am[2] ? "#".repeat(+am[2]) + " " + am[4] : am[4]) : parseLine(line);
    if (am) {
      const a = / align="(\w+)"/.exec(am[3]), l = / ls="([\d.]+)"/.exec(am[3]);
      if (a) ln.align = a[1];
      if (l) ln.ls = l[1];
      if (/ newpage/.test(am[3])) ln.newpage = true;
      if (/ pagebreak/.test(am[3])) ln.brk = true;
      const tc = / tc="([^"]+)"/.exec(am[3]);
      if (tc) ln.tcp = tc[1];
    }
    if (ln.kind === "ol" && ln.num === 1) ln.restart = true;
    const { number, restarted } = lists.step(ln);
    if (!restarted) delete ln.restart;
    delete ln.num;
    // a line that wouldn't be written back exactly is kept as it was
    if (line.trim() && lineMarkdown(ln, number, { asLoaded: true }) !== line) {
      out.push({ kind: null, runs: [{ t: line, f: new Set() }], raw: line, code: false });
      lists.reset();
    } else {
      delete ln.src;
      out.push(ln);
    }
  }
  return out;
}

function parseLine(line) {
  let m = BLOCK_RE.exec(line);
  let kind = null, body = line, mark = null;
  const q = QUOTE_RE.exec(line);
  if (q) { kind = "quote"; body = q[1]; m = null; }
  if (m) {
    if (m[1]) { kind = "h" + m[1].length; body = m[2]; }
    else if (m[4]) {
      kind = "ul"; body = m[6];
      const prefix = m[3] + m[4] + m[5];
      if (prefix !== "- ") mark = "ul:" + prefix;
    } else {
      kind = "ol"; body = m[10];
      if (m[7] || m[9] !== ". ") mark = "ol:" + m[7] + "\u0000" + m[9];
      // (RossDraft 1.7.0) its number as written: a 1 where the list would go on is a fresh start
      return { kind, mark, runs: inlineRuns(body), src: line, num: parseInt(m[8], 10) };
    }
  }
  return { kind, mark, runs: inlineRuns(body), src: line };
}

export function leadOf(ln) {
  if (!ln.mark) return "";
  const body = ln.mark.slice(3);
  if (ln.kind === "ul") return body.match(/^\s*/)[0];
  return body.split("\u0000")[0];
}

// depth (1, 2, ...) of each list line, and the number of each numbered line,
// worked out as the desktop does (a list per depth; any other line ends them all)
export class ListState {
  constructor() { this.reset(); }
  reset() { this.depths = []; this.lists = new Map(); }
  step(ln) {
    if (!isList(ln) || ln.code || ln.raw != null) { this.reset(); return { depth: 0, number: null }; }
    const width = leadOf(ln).replace(/\t/g, "    ").length;
    const depths = this.depths, lists = this.lists;
    while (depths.length && width < depths[depths.length - 1]) depths.pop();
    if (!depths.length || width > depths[depths.length - 1]) depths.push(width);
    const depth = depths.length;
    for (const key of [...lists.keys()]) if (+key.split("|")[1] > depth) lists.delete(key);
    const key = ln.kind + "|" + depth;
    if (!lists.has(key)) {
      for (const k2 of [...lists.keys()]) if (+k2.split("|")[1] === depth) lists.delete(k2);
      lists.set(key, 0);
    }
    // (RossDraft 1.7.0) Restart Numbering at 1: this item starts its list again
    let restarted = false;
    if (ln.kind === "ol" && ln.restart && lists.get(key) > 0) { lists.set(key, 0); restarted = true; }
    lists.set(key, lists.get(key) + 1);
    return { depth, number: lists.get(key), restarted };
  }
}

export function listLayout(lines) {
  const st = new ListState();
  const depthOf = [], numbers = [], restarts = [];
  for (const ln of lines) {
    const r = st.step(ln);
    depthOf.push(r.depth);
    numbers.push(r.number);
    restarts.push(!!r.restarted);
  }
  return { depthOf, numbers, restarts };
}

function isList(ln) { return ln.kind === "ul" || ln.kind === "ol"; }
export function listNumbers(lines) { return listLayout(lines).numbers; }

// ------------------------------------------------------------------ writing a note
const OPEN = { b: "**", i: "*", s: "~~", h: "==", u: "<u>", sup: "<sup>", sub: "<sub>" };
const CLOSE = { b: "**", i: "*", s: "~~", h: "==", u: "</u>", sup: "</sup>", sub: "</sub>" };
const ORDER = ["u", "h", "s", "b", "i"];
// (1.9.0) a run's keys to open, outermost first: font, size, colour; then u, h (with its colour), s, b, i; sup/sub
function keysOf(f) {
  const hc = [...f].find((k) => k.startsWith("hc:"));
  // (1.12.0) a tracked change outermost: an insertion or deletion, then a formatting change
  const tc = [...f].filter((k) => /^t[idf]:/.test(k)).sort((a, b) => "idf".indexOf(a[1]) - "idf".indexOf(b[1]));
  const look = [...f].filter((k) => /^(font|sz|c):/.test(k)).sort((a, b) => "fsc".indexOf(a[0]) - "fsc".indexOf(b[0]));
  const basic = ORDER.filter((k) => f.has(k)).map((k) => (k === "h" && hc ? "h:" + hc.slice(3) : k));
  return tc.concat(look, basic, ["sup", "sub"].filter((k) => f.has(k)));
}
const tcOpen = (k) => (k[1] === "i" ? `<ins data-tc="${k.slice(3)}">` : k[1] === "d" ? `<del data-tc="${k.slice(3)}">` : `<span data-tf="${k.slice(3)}">`);
const openOf = (k) => OPEN[k] || (k.startsWith("h:") ? `<mark class="hl-${k.slice(2)}">` : /^t[idf]:/.test(k) ? tcOpen(k) : spanOpen(k));
const closeOf = (k) => CLOSE[k] || (k.startsWith("h:") ? "</mark>" : k.startsWith("ti:") ? "</ins>" : k.startsWith("td:") ? "</del>" : "</span>");

function escape(t, atStart) {
  let s = "";
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === "[" && stickyMatch(LINK_AT, t, k)) s += "\\";
    if ("\\*_~=<`".includes(c)) {
      if ("*_~=".includes(c) || c === "\\" || (c === "<" && /^<\/?(u|mark|span|sup|sub|ins|del)\b/i.test(t.slice(k, k + 7))) || c === "`") s += "\\";
    }
    s += c;
  }
  if (atStart && (/^#{1,6}\s/.test(s) || /^[-+]\s/.test(s) || /^\d+[.)]\s/.test(s) || s.startsWith(">"))) s = "\\" + s;
  return s;
}

function sameFlags(a, b) {
  if (a.f.size !== b.f.size) return false;
  for (const x of a.f) if (!b.f.has(x)) return false;
  return (a.href || null) === (b.href || null);
}

// opts: { dir: the note's folder (parts), asLoaded }
export function lineMarkdown(ln, number, opts = {}) {
  if (ln.kind === "table") return tableMarkdown(ln, opts);
  if (ln.raw != null) {
    const text = ln.runs.map((r) => r.t).join("");
    if (text === ln.raw || ln.code) return text;
  }
  const kind = ln.kind;
  const heading = !!kind && kind[0] === "h";
  const merged = [];
  for (const r0 of ln.runs) {
    if (r0.img) { merged.push(r0); continue; }
    const t = r0.t.replace(/ /g, " ").split(OBJ).join("");
    if (!t) continue;
    const r = { t, f: heading ? new Set([...r0.f].filter((x) => x !== "b")) : r0.f, href: r0.href || null };
    const last = merged[merged.length - 1];
    if (last && !last.img && sameFlags(last, r)) last.t += r.t; else merged.push(r);
  }
  const out = [];
  const openNow = [];
  let pending = "";
  for (const r of merged) {
    if (r.img) {
      while (openNow.length) out.push(closeOf(openNow.pop()));
      out.push(pending);
      pending = "";
      out.push(pictureOut(r.img, opts));
      continue;
    }
    const t = r.t;
    const core = t.replace(/^ +| +$/g, "");
    const lead = t.slice(0, t.length - t.replace(/^ +/, "").length);
    const trail = core ? t.slice(t.replace(/ +$/, "").length) : "";
    if (!core) { pending += t; continue; }
    const want = keysOf(r.f);
    // close back to where what's open is still wanted, in order (so the tags nest)
    const fancy = (k) => k.includes(":") || k === "sup" || k === "sub";
    if (want.some(fancy) || openNow.some(fancy)) {
      let keep = 0;
      while (keep < openNow.length && keep < want.length && openNow[keep] === want[keep]) keep++;
      while (openNow.length > keep) out.push(closeOf(openNow.pop()));
    } else if (openNow.some((k) => !want.includes(k))) {
      // (as before 1.9.0, so notes written then read back the same)
      while (openNow.length && openNow.some((k) => !want.includes(k))) out.push(closeOf(openNow.pop()));
    }
    out.push(pending + lead);
    pending = "";
    for (const k of want) if (!openNow.includes(k)) { out.push(openOf(k)); openNow.push(k); }
    const link = r.href;
    if (link == null) out.push(escape(core, !out.join("").trim()));
    else if (hrefOf(core) === link && urlSpan(core, 0) === core.length) out.push(core);
    else out.push("[" + escape(core, false).replace(/]/g, "\\]") + "](" + link.replace(/\)/g, "%29").replace(/ /g, "%20") + ")");
    pending = trail;
  }
  while (openNow.length) out.push(closeOf(openNow.pop()));
  out.push(pending);
  const body = out.join("");
  const al = ALIGNS.includes(ln.align) ? ln.align : null;
  const ls = ln.ls && /^\d+(\.\d+)?$/.test(String(ln.ls)) ? String(ln.ls) : null;
  const tcp = ln.tcp && /^[idf]-?\d+( [idf]-?\d+)*$/.test(ln.tcp) ? ln.tcp : null;
  const attrs = (al ? ` align="${al}"` : "") + (ls ? ` ls="${ls}"` : "") + (ln.newpage ? " newpage" : "") + (ln.brk ? " pagebreak" : "") +
    (tcp ? ` tc="${tcp}"` : "");
  if (attrs && heading) return `<${kind}${attrs}>${body}</${kind}>`;
  const whole = lineOut(ln, kind, heading, body, number);
  return attrs && (body.trim() || ln.newpage || ln.brk || tcp) ? `<p${attrs}>${whole}</p>` : whole;
}

function lineOut(ln, kind, heading, body, number) {
  const mark = ln.mark;
  if (kind === "quote") return "> " + body;
  if (heading) return "#".repeat(+kind.slice(1)) + " " + body;
  if (kind === "ul") return (mark && mark.startsWith("ul:") ? mark.slice(3) : "- ") + body;
  if (kind === "ol") {
    if (mark && mark.startsWith("ol:")) {
      const [lead, tail] = mark.slice(3).split("\u0000");
      return lead + (number || 1) + tail + body;
    }
    return (number || 1) + ". " + body;
  }
  return body;
}

function pictureOut(img, opts) {
  // as it was in the file, unless its size changed or it no longer points at the picture from here
  if (img.orig && (opts.asLoaded || (!img.changed && (!img.target || !opts.dir ||
      samePath(resolvePicture(img.src, opts.dir), img.target))))) {
    return img.orig;
  }
  if (img.target && opts.dir) return pictureMarkdown(img.target, img.size, opts.dir);
  return "![" + (img.size || "") + "](" + img.src + ")";
}

function samePath(a, b) { return !!a && !!b && a.length === b.length && a.every((x, k) => x === b[k]); }

export function serialize(lines, opts = {}) {
  const numbers = listNumbers(lines);
  const out = lines.map((ln, k) => lineMarkdown(ln, numbers[k], opts));
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ titles and names
export function titleOf(text, limit = 80) {
  for (const line of text.split("\n")) {
    let s = line.trim();
    const am = PARA_RE.exec(s);
    if (am && am[3]) s = am[4].trim();
    const m = BLOCK_RE.exec(s);
    if (m) s = (m[1] ? m[2] : m[4] ? m[6] : m[10]) || "";
    const q = QUOTE_RE.exec(s);
    if (q) s = q[1];
    s = inlineRuns(s).map((r) => r.t).join("").split(OBJ).join("").trim();
    if (s) return s.slice(0, limit);
  }
  return "";
}

export function titleOfLines(lines, limit = 80) {
  for (const ln of lines) {
    const s = ln.runs.map((r) => (r.img ? "" : r.t)).join("").trim();
    if (s) return s.slice(0, limit);
  }
  return "";
}

// store.safe_name
export function safeName(title) {
  let t = (title || "").replace(/[\x00-\x1f/\\:*?"<>|]/g, " ");
  t = t.replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  if (t.length > 80) t = t.slice(0, 80).trimEnd();
  return t || "Untitled";
}

export function longDate(withTime = false) {
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December"];
  let s = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  if (withTime) s += ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return s;
}

// a note's Markdown with its title (its first line with words) made a heading (the laptop's notesio.title_as_heading)
const MARKER = /^(#{1,6}\s+|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?)/;
export function titleAsHeading(text, level) {
  const lines = text.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (line.trim()) {
      const lv = Math.max(1, Math.min(6, level));
      const am = ALIGN_RE.exec(line.trim());
      if (am) {
        // an aligned first line: the heading keeps its alignment
        const inner = am[2] ? am[4] : am[4].replace(MARKER, "");
        lines[k] = `<h${lv} align="${am[3]}">${inner.trim()}</h${lv}>`;
      } else {
        const body = line.trimStart().startsWith("|") ? line.trim() : line.replace(MARKER, "").trim();
        lines[k] = "#".repeat(lv) + " " + body;
      }
      // the note's own headings go down with it (not inside code)
      let fence = null;
      for (let j = k + 1; j < lines.length; j++) {
        const f = FENCE_RE.exec(lines[j]);
        if (fence) { if (f && f[1] === fence) fence = null; continue; }
        if (f) { fence = f[1]; continue; }
        const h = /^(#{1,6})\s/.exec(lines[j]);
        if (h && level > 1) lines[j] = "#".repeat(Math.min(6, h[1].length + level - 1)) + lines[j].slice(h[1].length);
        const ha = /^<h([1-6]) align="(center|right|justify)">(.*)<\/h\1>$/s.exec(lines[j]);
        if (ha && level > 1) { const n = Math.min(6, +ha[1] + level - 1); lines[j] = `<h${n} align="${ha[2]}">${ha[3]}</h${n}>`; }
      }
      return lines.slice(k).join("\n").replace(/\n+$/, "") + "\n";
    }
  }
  return "";
}

// (RossDraft 1.7.0) a numbered list's number by its level, as Word's multilevel list: 1. / a. / i. / 1. ...
export function numberLabel(n, depth) {
  const k = ((depth || 1) - 1) % 3;
  if (k === 1) { let s = ""; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  if (k === 2) {
    const R = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let s = "";
    for (const [v, t] of R) while (n >= v) { s += t; n -= v; }
    return s;
  }
  return String(n);
}

// ------------------------------------------------------------------ (RossDraft 1.12.0) tracked changes
export const isChangeFlag = (k) => /^t[idf]:/.test(k);
export function hasChanges(lines) {
  return (lines || []).some((ln) => ln.tcp || (ln.runs || []).some((r) => r.f && [...r.f].some(isChangeFlag)) ||
    (ln.cells || []).some((row) => row.some((c) => hasChanges(c))));
}
// the lines as they'd read with every change accepted (for Compile, exports, word counts, Preview Final):
// taken-out words gone, added ones plain, a paragraph whose end was taken out joined to the next
export function finalLines(lines) {
  if (!hasChanges(lines)) return lines;
  const out = [];
  let join = false;
  for (const ln0 of lines) {
    const ln = { ...ln0 };
    if (ln.cells) ln.cells = ln.cells.map((row) => row.map((c) => finalLines(c)));
    if (ln.runs) ln.runs = ln.runs.filter((r) => !(r.f && [...r.f].some((k) => k.startsWith("td:"))))
      .map((r) => (r.f && [...r.f].some(isChangeFlag) ? { ...r, f: new Set([...r.f].filter((k) => !isChangeFlag(k))) } : r));
    const gone = !!(ln.tcp && /(^| )d/.test(ln.tcp));
    delete ln.tcp;
    if (join && out.length && !ln.cells && !out[out.length - 1].cells) {
      const prev = out[out.length - 1];
      // (a line's own last space isn't kept in the note: one between the words, as the Word file has)
      const pt = prev.runs.map((r) => r.t || "").join(""), nt = (ln.runs || []).map((r) => r.t || "").join("");
      const gap = pt && nt && !/\s$/.test(pt) && !/^[\s.,;:!?)\]’”]/.test(nt) ? [{ t: " ", f: new Set() }] : [];
      prev.runs = prev.runs.concat(gap, ln.runs || []);
    } else out.push(ln);
    join = gone;
  }
  return out;
}
// (1.12.0) the lines as they were before the changes (Review ▸ Original): added words gone, taken-out ones plain,
// changed formatting as it was (changes[].old: the run's flags; .oldAlign: the paragraph's alignment), a paragraph
// end that was added joined to the next
const LOOK_KEYS = (k) => ["b", "i", "u", "s", "h", "sup", "sub"].includes(k) || /^(hc|c|font|sz):/.test(k);
export function originalLines(lines, changes) {
  if (!hasChanges(lines)) return lines;
  const byId = new Map((changes || []).map((c) => [String(c.id), c]));
  const out = [];
  let join = false;
  for (const ln0 of lines) {
    const ln = { ...ln0 };
    if (ln.cells) ln.cells = ln.cells.map((row) => row.map((c) => originalLines(c, changes)));
    if (ln.runs) {
      ln.runs = ln.runs.filter((r) => !(r.f && [...r.f].some((k) => k.startsWith("ti:")))).map((r) => {
        if (!r.f || ![...r.f].some(isChangeFlag)) return r;
        const tf = [...r.f].find((k) => k.startsWith("tf:"));
        const was = tf && byId.get(tf.slice(3));
        let f = [...r.f].filter((k) => !isChangeFlag(k));
        if (was && was.old) f = f.filter((k) => !LOOK_KEYS(k)).concat(was.old.filter(LOOK_KEYS));
        return { ...r, f: new Set(f) };
      });
    }
    const toks = (ln.tcp || "").split(" ").filter(Boolean);
    for (const t of toks) {
      const c = t[0] === "f" ? byId.get(t.slice(1)) : null;
      if (c && "oldAlign" in c) { if (c.oldAlign) ln.align = c.oldAlign; else delete ln.align; }
    }
    const added = toks.some((t) => t[0] === "i");
    delete ln.tcp;
    if (join && out.length && !ln.cells && !out[out.length - 1].cells) {
      const prev = out[out.length - 1];
      const pt = prev.runs.map((r) => r.t || "").join(""), nt = (ln.runs || []).map((r) => r.t || "").join("");
      const gap = pt && nt && !/\s$/.test(pt) && !/^[\s.,;:!?)\]’”]/.test(nt) ? [{ t: " ", f: new Set() }] : [];
      prev.runs = prev.runs.concat(gap, ln.runs || []);
    } else out.push(ln);
    join = added;
  }
  return out;
}
