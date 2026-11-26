// The page: one <div class="ln"> per line of the note, with the formatting as
// ordinary elements. Read back to lines (md.js) to save.
import * as md from "./md.js?v=1.9.22-d1.15.0";

const HL = "#ffd54f";

// ------------------------------------------------------------------ lines -> page
export function renderLines(page, lines) {
  page.textContent = "";
  for (const ln of lines) page.appendChild(lineElement(ln));
  if (!page.firstChild) page.appendChild(lineElement({ kind: null, runs: [] }));
}

// RossDraft 1.2: a footnote's or endnote's mark ("\uE000f17\uE001" in the words): a small raised number the caret
// steps over, one character's worth of the page (its number set by numberNotes)
const NOTE_SPLIT = /(\uE000[fe]-?\d+\uE001)/;
export function noteElement(token) {
  const e = document.createElement("sup");
  e.className = "fnref";
  e.contentEditable = "false";
  e.dataset.m = token;
  e.dataset.k = token.slice(1, -1);
  e.textContent = "•";
  return e;
}
// the marks numbered in order on the page: footnotes 1, 2, 3…, endnotes i, ii, iii…
const ROMAN = (n) => { let r = ""; for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]) while (n >= v) { r += s; n -= v; } return r; };
export function numberNotes(page) {
  const k = { f: 0, e: 0 };
  const labels = new Map();
  for (const e of page.querySelectorAll("sup.fnref")) {
    const kind = e.dataset.k[0];
    k[kind] += 1;
    const label = kind === "e" ? ROMAN(k.e) : String(k.f);
    if (e.textContent !== label) e.textContent = label;
    labels.set(e.dataset.k, label);
  }
  return labels;
}

// RossDraft 1.8.0: a table, as one line of the page: the table itself can't be typed over (contenteditable
// false), its cells can (each cell's paragraphs a <div class="cp">). md.js has the line; readLine reads it back.
export function tableElement(ln) {
  const div = document.createElement("div");
  div.className = "ln tline";
  div.dataset.kind = "table";
  div.contentEditable = "false";
  if (ln.noLines) div.dataset.nolines = "1";
  if (ln.equal) div.dataset.equal = "1";
  const t = document.createElement("table");
  t.className = "rtable";
  const tb = document.createElement("tbody");
  const w = Math.max(1, ...(ln.cells || []).map((r) => r.length));
  if (ln.widths && ln.widths.length === w) setWidths(t, ln.widths);
  (ln.cells || []).forEach((row, r) => {
    const tr = document.createElement("tr");
    for (let c = 0; c < w; c++) {
      const td = cellElement(row[c] || []);
      const m = ln.cover && ln.cover[r + "." + c];
      if (m === "l" || m === "u") td.dataset.m = m;
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  div.appendChild(t);
  applySpans(t);
  return div;
}
// (RossDraft 1.13.0) merged cells: every cell of the grid is there; one merged into the cell to its left (data-m="l")
// or above ("u") is hidden, and the cell it's merged into spans it
export function applySpans(t) {
  const rows = [...t.querySelectorAll(":scope > tbody > tr")].map((tr) => [...tr.children].filter((c) => c.tagName === "TD"));
  rows.forEach((row, r) => row.forEach((td, c) => {
    const m = td.dataset.m;
    td.classList.toggle("covered", m === "l" || m === "u");
    if (m === "l" || m === "u") { td.colSpan = 1; td.rowSpan = 1; return; }
    let cs = 1, rs = 1;
    while (row[c + cs] && row[c + cs].dataset.m === "l") cs++;
    while (rows[r + rs] && rows[r + rs][c] && rows[r + rs][c].dataset.m === "u") rs++;
    td.colSpan = cs;
    td.rowSpan = rs;
  }));
}
// (1.8.1) the columns' widths (Word's twips) as a <colgroup>: each column its share of the table
export function setWidths(t, widths) {
  let cg = t.querySelector(":scope > colgroup");
  if (!widths) { if (cg) cg.remove(); t.classList.remove("fixed"); return; }
  if (!cg) { cg = document.createElement("colgroup"); t.insertBefore(cg, t.firstChild); }
  cg.textContent = "";
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  for (const x of widths) {
    const c = document.createElement("col");
    c.dataset.w = String(Math.round(x));
    c.style.width = (100 * x / sum).toFixed(3) + "%";
    cg.appendChild(c);
  }
  t.classList.add("fixed");
}
export function widthsOf(t) {
  const cols = t.querySelectorAll(":scope > colgroup > col");
  return cols.length ? [...cols].map((c) => +c.dataset.w || 0) : null;
}
export function cellElement(paras) {
  const td = document.createElement("td");
  td.contentEditable = "true";
  td.className = "rcell";
  for (const p of paras.length ? paras : [{ kind: null, runs: [] }]) {
    const d = lineElement({ kind: null, runs: p.runs || [], align: p.align });
    d.className = "cp";
    td.appendChild(d);
  }
  return td;
}
// a cell's paragraphs, however the browser's editing left them (stray words, <br>s, <div>s)
export function readCell(td) {
  const paras = [];
  let loose = null;
  const flush = () => { if (loose) { paras.push(readLine(loose)); loose = null; } };
  for (const c of td.childNodes) {
    if (c.nodeType === 1 && (c.tagName === "DIV" || c.tagName === "P")) {
      flush();
      paras.push(readLine(c));
    } else if (c.nodeType === 1 && c.tagName === "BR") {
      if (loose) flush(); else if (paras.length || c.nextSibling) paras.push({ kind: null, runs: [] });
    } else {
      if (!loose) loose = document.createElement("div");
      loose.appendChild(c.cloneNode(true));
    }
  }
  flush();
  for (const p of paras) { p.kind = null; delete p.mark; delete p.restart; }
  if (!paras.length) paras.push({ kind: null, runs: [] });
  return paras;
}
export function readTable(div) {
  const ln = { kind: "table", runs: [], cells: [] };
  const cover = {};
  [...div.querySelectorAll(":scope > table > tbody > tr")].forEach((tr, r) => {
    const tds = [...tr.children].filter((c) => c.tagName === "TD");
    tds.forEach((td, c) => { if (td.dataset.m === "l" || td.dataset.m === "u") cover[r + "." + c] = td.dataset.m; });
    ln.cells.push(tds.map((td) => (td.dataset.m ? [{ kind: null, runs: [] }] : readCell(td))));
  });
  if (Object.keys(cover).length) ln.cover = cover;
  if (div.dataset.nolines) ln.noLines = true;
  if (div.dataset.equal) ln.equal = true;
  const t = div.querySelector(":scope > table");
  const ws = t && widthsOf(t);
  const n = Math.max(0, ...ln.cells.map((r) => r.length));
  if (ws && ws.length === n && ws.every((x) => x > 0)) ln.widths = ws;
  return ln;
}
const isCellStart = (c) => c.nodeType === 1 && (c.tagName === "TD" || c.tagName === "TR" || (c.classList && c.classList.contains("cp"))) && !!c.previousElementSibling;

// (RossDraft 1.9.0) the words' own look: colour, font, size (shown against the scene's usual size, --usz)
export const HLS = { yellow: "#fff176", green: "#b9f6ca", cyan: "#b2ebf2", magenta: "#f8bbd0", lightGray: "#e0e0e0",
  red: "#ffcdd2", blue: "#bbdefb", darkYellow: "#e6d690", darkGreen: "#a5d6a7", darkCyan: "#80cbc4", darkMagenta: "#ce93d8",
  darkRed: "#ef9a9a", darkBlue: "#9fa8da", darkGray: "#bdbdbd", black: "#9e9e9e" };
function lookWrap(f, wrap) {
  for (const k of f) {
    if (k.startsWith("c:")) wrap("span", "color: #" + k.slice(2) + ";", { rd: k });
  }
  for (const k of f) {
    if (k.startsWith("sz:")) wrap("span", `font-size: calc(1em * ${+k.slice(3)} / var(--usz, 24));`, { rd: k });
  }
  for (const k of f) {
    if (k.startsWith("font:")) wrap("span", `font-family: "${k.slice(5).replace(/"/g, "")}", var(--page-font, serif);`, { rd: k });
  }
  for (const k of f) {
    if (k.startsWith("lang:")) wrap("span", "", { rd: k, lang: k.slice(5) });     // (1.15.0) another language
  }
}
export function lineElement(ln) {
  if (ln.kind === "table") return tableElement(ln);
  const div = document.createElement("div");
  div.className = "ln";
  if (ln.kind) div.dataset.kind = ln.kind;
  if (ln.mark) div.dataset.mark = ln.mark;
  if (ln.restart) div.dataset.restart = "1";
  if (ln.raw != null) div.dataset.raw = ln.raw;
  if (ln.code) div.dataset.code = "1";
  if (ln.align && !ln.code && md.ALIGNS.includes(ln.align)) div.dataset.align = ln.align;
  // (RossDraft 1.9.0) its own line spacing; Start on New Page; a page break before it
  if (ln.ls && !ln.code) { div.dataset.ls = String(ln.ls); div.style.setProperty("--ls", String(ln.ls)); }
  if (ln.newpage) div.dataset.newpage = "1";
  if (ln.brk) div.dataset.pagebreak = "1";
  if (ln.tcp) div.dataset.tcp = ln.tcp;         // (RossDraft 1.12.0) its end or settings changed (tracked)
  if (ln.toc) {
    // (RossDraft 1.14.0) a line of a contents list: shown as it is (its words, dots, its page), not typed in; read
    // back as it was given
    div.dataset.toc = ln.toc;
    div.contentEditable = "false";
    div.dataset.tocln = JSON.stringify({ ...ln, runs: (ln.runs || []).map((r) => ({ ...r, f: [...(r.f || [])] })) });
  }
  for (const r of ln.runs) {
    if (r.img) { div.appendChild(pictureElement(r.img)); continue; }
    if (!r.t) continue;
    if (r.t.includes("\uE000")) {
      // the words around a note's mark as runs of their own, the mark itself a raised number
      for (const piece of r.t.split(NOTE_SPLIT)) {
        if (!piece) continue;
        if (NOTE_SPLIT.test(piece) && piece[0] === "\uE000") div.appendChild(noteElement(piece));
        else div.appendChild(lineElement({ kind: null, runs: [{ t: piece, f: r.f, href: r.href }] }).firstChild);
      }
      continue;
    }
    let node = document.createTextNode(r.t);
    const wrap = (tag, style) => {
      const e = document.createElement(tag);
      if (style) e.setAttribute("style", style);
      e.appendChild(node);
      node = e;
    };
    if (r.f.has("sup")) wrap("sup");
    if (r.f.has("sub")) wrap("sub");
    if (r.f.has("i")) wrap("i");
    if (r.f.has("b")) wrap("b");
    if (r.f.has("s")) wrap("strike");
    if (r.f.has("h")) {
      const hc = [...r.f].find((k) => k.startsWith("hc:"));
      wrap("span", "background-color: " + (hc ? HLS[hc.slice(3)] || HL : HL) + ";");
      if (hc) node.dataset.hc = hc.slice(3);
    }
    if (r.f.has("u")) wrap("u");
    lookWrap(r.f, (tag, style, data) => { wrap(tag, style); Object.assign(node.dataset, data); });
    // (RossDraft 1.12.0) a tracked change: added words underlined, taken-out ones struck through (and not typed
    // into: a box of their own), a formatting change marked
    for (const k of r.f) {
      if (k.startsWith("tf:")) { wrap("span"); node.className = "tcf"; node.dataset.tf = k.slice(3); }
    }
    // (RossDraft 1.13.0) a field (page number, date…): its result, in a box of its own
    for (const k of r.f) {
      if (k.startsWith("fld:")) {
        wrap("span"); node.className = "fld"; node.dataset.fld = k.slice(4); node.contentEditable = "false";
        try { node.title = "Field: " + decodeURIComponent(k.slice(4)); } catch (e) { /* as it is */ }
      }
    }
    for (const k of r.f) {
      if (k.startsWith("ti:")) { wrap("ins"); node.className = "tc"; node.dataset.tc = k.slice(3); }
      else if (k.startsWith("td:")) { wrap("del"); node.className = "tc"; node.dataset.tc = k.slice(3); node.contentEditable = "false"; }
    }
    if (r.href) {
      const a = document.createElement("a");
      a.href = r.href;
      a.appendChild(node);
      node = a;
    }
    div.appendChild(node);
  }
  if (!div.firstChild) div.appendChild(document.createElement("br"));
  if (ln.toc) {
    // (1.14.0) the contents line's last tab: dots to its page number
    const tw = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let t = tw.nextNode(); t; t = tw.nextNode()) if (t.data.includes("\t")) last = t;
    if (last) {
      const k = last.data.lastIndexOf("\t");
      const after = last.splitText(k);
      after.deleteData(0, 1);
      const dots = document.createElement("span");
      dots.className = "tocdots";
      last.parentNode.insertBefore(dots, after);
      for (const t of [...div.querySelectorAll("*")].flatMap((e) => [...e.childNodes]).concat([...div.childNodes])) if (t.nodeType === 3 && t.data.includes("\t")) t.data = t.data.replace(/\t/g, " ");
    }
  }
  return div;
}

export function pictureElement(img) {
  const e = document.createElement("img");
  e.className = "pic";
  e.alt = "";
  e.draggable = false;
  e.dataset.src = img.src || "";
  if (img.orig) e.dataset.orig = img.orig;
  e.dataset.size = ["small", "medium"].includes(img.size) ? img.size : "";
  if (img.size && !["small", "medium"].includes(img.size)) e.dataset.alt = img.size;
  if (img.target) e.dataset.target = img.target.join("/");
  if (img.changed) e.dataset.changed = "1";
  return e;
}

// ------------------------------------------------------------------ page -> lines
function hasBackground(el) {
  const bg = el.style && el.style.backgroundColor;
  return !!bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg) && bg !== "initial" && bg !== "inherit";
}

// (1.9.0) an element's colour, font, size, highlight colour (ours: data-rd / data-hc; else its style or <font>)
const has = (f, p) => [...f].some((k) => k.startsWith(p));
export function hexOf(c) {
  if (!c) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) return (m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1]).toUpperCase();
  const r = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(c);
  if (r && (r[4] == null || +r[4] > 0)) return [r[1], r[2], r[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}
function nearestHl(c) {
  const h = hexOf(c);
  if (!h) return null;
  const rgb = (x) => [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
  const a = rgb(h);
  let best = null, bd = 1e9;
  for (const [name, v] of Object.entries(HLS)) {
    const b = rgb(v.slice(1));
    const d = a.reduce((s, x, k) => s + (x - b[k]) ** 2, 0);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}
function lookOf(e, f) {
  const rd = e.dataset && e.dataset.rd;
  if (rd) {
    const p = rd.slice(0, rd.indexOf(":") + 1);
    if (p && !has(f, p)) f.add(rd);
    return;
  }
  if (e.dataset && e.dataset.hc && !has(f, "hc:")) { if (e.dataset.hc !== "yellow") f.add("hc:" + e.dataset.hc); return; }
  const st = e.style;
  if (e.tagName === "FONT") {
    const col = hexOf(e.getAttribute("color"));
    if (col && !has(f, "c:")) f.add("c:" + col);
    const face = e.getAttribute("face");
    if (face && !has(f, "font:")) f.add("font:" + face.split(",")[0].replace(/["']/g, "").trim());
  }
  if (st) {
    const col = st.color && hexOf(st.color);
    if (col && !has(f, "c:")) f.add("c:" + col);
    if (st.backgroundColor && hasBackground(e) && !has(f, "hc:")) {
      const n = nearestHl(st.backgroundColor);
      if (n && n !== "yellow") f.add("hc:" + n);
    }
  }
}
export function flagsOf(node, line, heading) {
  const f = new Set();
  let href = null;
  for (let e = node.parentNode; e && e !== line; e = e.parentNode) {
    const t = e.tagName;
    // (RossDraft 1.12.0) a tracked change's mark (not underlining or striking through)
    if ((t === "INS" || t === "DEL") && e.dataset && e.dataset.tc != null) { if (!has(f, "ti:") && !has(f, "td:")) f.add((t === "INS" ? "ti:" : "td:") + e.dataset.tc); continue; }
    if (t === "SPAN" && e.dataset && e.dataset.tf != null) { if (!has(f, "tf:")) f.add("tf:" + e.dataset.tf); continue; }
    if (t === "SPAN" && e.dataset && e.dataset.fld != null) { if (!has(f, "fld:")) f.add("fld:" + e.dataset.fld); continue; }
    if (t === "B" || t === "STRONG") f.add("b");
    else if (t === "I" || t === "EM") f.add("i");
    else if (t === "U" || t === "INS") f.add("u");
    else if (t === "S" || t === "STRIKE" || t === "DEL") f.add("s");
    else if (t === "MARK") f.add("h");
    else if (t === "A" && e.getAttribute("href") && href == null) href = e.getAttribute("href");
    else if ((t === "SUP" || t === "SUB") && !(e.classList && e.classList.contains("fnref"))) { if (!f.has("sup") && !f.has("sub")) f.add(t.toLowerCase()); }
    lookOf(e, f);
    const st = e.style;
    if (st) {
      if (st.fontWeight === "bold" || +st.fontWeight >= 600) f.add("b");
      if (st.fontStyle === "italic") f.add("i");
      const td = st.textDecoration || st.textDecorationLine || "";
      if (td.includes("underline")) f.add("u");
      if (td.includes("line-through")) f.add("s");
      if (hasBackground(e)) f.add("h");
    }
  }
  if (heading) f.delete("b");
  if (!f.has("h")) for (const k of [...f]) if (k.startsWith("hc:")) f.delete(k);
  return { f, href };
}

export function readLine(div) {
  if (div.dataset.kind === "table") return readTable(div);
  const kind = div.dataset.kind || null;
  const ln = { kind, mark: div.dataset.mark || null, runs: [] };
  if (div.dataset.restart && kind === "ol") ln.restart = true;
  if (div.dataset.raw != null) ln.raw = div.dataset.raw;
  if (div.dataset.code) ln.code = true;
  if (div.dataset.align && !ln.code && md.ALIGNS.includes(div.dataset.align)) ln.align = div.dataset.align;
  if (div.dataset.ls && !ln.code) ln.ls = div.dataset.ls;
  if (div.dataset.newpage) ln.newpage = true;
  if (div.dataset.pagebreak) ln.brk = true;
  if (div.dataset.tcp) ln.tcp = div.dataset.tcp;
  if (div.dataset.tocln) {
    try { const o = JSON.parse(div.dataset.tocln); return { ...o, runs: (o.runs || []).map((r) => ({ ...r, f: new Set(r.f || []) })) }; } catch (e) { /* as read */ }
  }
  const heading = !!kind && kind[0] === "h";
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.data.replace(/[\n\r]/g, " ").replace(/​/g, "");
        if (!t) continue;
        if (ln.code || ln.raw != null) { ln.runs.push({ t, f: new Set() }); continue; }
        const { f, href } = flagsOf(c, div, heading);
        ln.runs.push({ t, f, href });
      } else if (c.nodeType === 1) {
        if (c.tagName === "SUP" && c.classList.contains("fnref")) {
          ln.runs.push({ t: c.dataset.m, f: new Set() });
        } else if (c.tagName === "IMG" && c.classList.contains("pic")) {
          ln.runs.push({ t: md.OBJ, f: new Set(), img: {
            src: c.dataset.src, orig: c.dataset.orig || null,
            size: c.dataset.size || c.dataset.alt || "",
            target: c.dataset.target ? c.dataset.target.split("/") : null,
            changed: !!c.dataset.changed } });
        } else if (c.tagName !== "BR") walk(c);
      }
    }
  };
  walk(div);
  return ln;
}

export function readLines(page) {
  return [...page.children].filter((d) => d.classList.contains("ln")).map(readLine);
}

// ------------------------------------------------------------------ keeping the page tidy
// The browser's editing can leave text outside the lines, or a line inside a
// line: put everything back into one level of lines.
export function tidy(page) {
  let changed = false;
  let pending = null;
  for (const n of [...page.childNodes]) {
    // 1.9.3: where one note ends and the next begins, on a page of several notes
    if (n.nodeType === 1 && n.classList.contains("jdiv")) { pending = null; continue; }
    if (n.nodeType === 1 && n.classList.contains("ln") && n.tagName === "DIV") {
      pending = null;
      // a line inside a line (pasting, or the browser's own Enter)
      const inner = [...n.children].filter((c) => c.tagName === "DIV" || c.tagName === "P");
      if (inner.length) {
        changed = true;
        let after = n;
        for (const c of inner) {
          const nl = document.createElement("div");
          nl.className = "ln";
          if (c.dataset && c.dataset.kind) nl.dataset.kind = c.dataset.kind;
          if (c.dataset && c.dataset.align) nl.dataset.align = c.dataset.align;
          while (c.firstChild) nl.appendChild(c.firstChild);
          c.remove();
          after.after(nl);
          after = nl;
        }
      }
      if (!n.firstChild) { n.appendChild(document.createElement("br")); }
      continue;
    }
    if (n.nodeType === 3 && !n.data.trim() && !pending) { n.remove(); continue; }
    changed = true;
    if (n.nodeType === 1 && (n.tagName === "DIV" || n.tagName === "P")) {
      n.classList.add("ln");
      if (n.tagName === "P") {
        const d = document.createElement("div");
        d.className = "ln";
        while (n.firstChild) d.appendChild(n.firstChild);
        n.replaceWith(d);
      }
      pending = null;
      continue;
    }
    if (!pending) {
      pending = document.createElement("div");
      pending.className = "ln";
      n.before(pending);
    }
    pending.appendChild(n);
  }
  if (!page.firstChild) { page.appendChild(lineElement({ kind: null, runs: [] })); changed = true; }
  return changed;
}

// ------------------------------------------------------------------ where the caret is
export function lineOf(node, page) {
  while (node && node.parentNode !== page) node = node.parentNode;
  return node && node.nodeType === 1 && node.classList.contains("ln") ? node : null;
}

// characters before (node, offset) within its line; a picture counts as one
export function offsetIn(line, node, offset) {
  const r = document.createRange();
  r.setStart(line, 0);
  try { r.setEnd(node, offset); } catch (e) { return 0; }
  return textLen(r.cloneContents());
}

function textLen(n) {
  let k = 0;
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (isCellStart(c)) k += 1;
      if (c.nodeType === 3) k += c.data.length;
      else if (c.tagName === "IMG") k += 1;
      else if (c.tagName === "SUP" && c.classList && c.classList.contains("fnref")) k += c.dataset.m.length;
      else walk(c);
    }
  };
  walk(n);
  return k;
}

export function lineText(line) {
  let s = "";
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (isCellStart(c)) s += " ";      // (a table's cells and paragraphs: a space between)
      if (c.nodeType === 3) s += c.data;
      else if (c.tagName === "IMG") s += md.OBJ;
      else if (c.tagName === "SUP" && c.classList.contains("fnref")) s += c.dataset.m;
      else walk(c);
    }
  };
  walk(line);
  return s;
}

// (node, offset) for a character position in a line
export function pointAt(line, pos) {
  let k = 0;
  let last = null;
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (isCellStart(c)) k += 1;
      if (c.nodeType === 3) {
        if (k + c.data.length >= pos) return [c, pos - k];
        k += c.data.length;
        last = [c, c.data.length];
      } else if (c.tagName === "IMG" || (c.tagName === "SUP" && c.classList.contains("fnref"))) {
        const len = c.tagName === "IMG" ? 1 : c.dataset.m.length;
        if (k + len > pos) return [c.parentNode, [...c.parentNode.childNodes].indexOf(c)];
        k += len;
        last = [c.parentNode, [...c.parentNode.childNodes].indexOf(c) + 1];
      } else if (c.tagName !== "BR") {
        const got = walk(c);
        if (got) return got;
      }
    }
    return null;
  };
  return walk(line) || last || [line, 0];
}

export function caret(page) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const line = lineOf(r.startContainer, page);
  if (!line) return null;
  const lines = [...page.children];
  const a = { line: lines.indexOf(line), pos: offsetIn(line, r.startContainer, r.startOffset) };
  const endLine = lineOf(r.endContainer, page) || line;
  const b = { line: lines.indexOf(endLine), pos: offsetIn(endLine, r.endContainer, r.endOffset) };
  return { a, b };
}

export function setCaret(page, c) {
  if (!c) return;
  const lines = [...page.children];
  const la = lines[Math.min(c.a.line, lines.length - 1)];
  const lb = lines[Math.min(c.b.line, lines.length - 1)];
  if (!la) return;
  const [n1, o1] = pointAt(la, c.a.pos);
  const [n2, o2] = pointAt(lb, c.b.pos);
  const r = document.createRange();
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

export function placeCaret(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// the lines the selection touches
export function selectedLines(page) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [];
  const r = sel.getRangeAt(0);
  const a = lineOf(r.startContainer, page), b = lineOf(r.endContainer, page);
  if (!a) return [];
  const all = [...page.children];
  const i = all.indexOf(a), j = b ? all.indexOf(b) : i;
  return all.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// ------------------------------------------------------------------ list numbers, depths, the title
export function relayout(page) {
  const lines = [...page.children];
  let st = new md.ListState();
  let titled = false;
  for (const div of lines) {
    if (div.classList.contains("jdiv")) { st = new md.ListState(); titled = false; continue; }   // the next note
    const ln = { kind: div.dataset.kind || null, mark: div.dataset.mark || null,
      raw: div.dataset.raw != null ? div.dataset.raw : null, code: !!div.dataset.code, restart: !!div.dataset.restart };
    const { depth, number } = st.step(ln);
    if (depth) div.dataset.depth = depth; else delete div.dataset.depth;
    if (number != null && ln.kind === "ol") {
      // (RossDraft 1.7.0) 1. / a. / i. by level, as in Word and Ross Writer
      const shown = md.numberLabel(number, depth);
      let label = shown + ".";
      if (ln.mark && ln.mark.startsWith("ol:")) label = shown + ln.mark.split("\u0000")[1].trim();
      div.dataset.n = label;
    } else delete div.dataset.n;
    const has = !titled && lineText(div).replace(md.OBJ, "").trim();
    div.classList.toggle("title", !!has && !(ln.kind && ln.kind[0] === "h"));
    if (has) titled = true;
  }
  if (page.querySelector("sup.fnref")) numberNotes(page);   // (RossDraft 1.2: the notes' numbers in order)
}

// ------------------------------------------------------------------ text pasted or dropped in
// Keep Source Formatting: a pasted element's colour, font, size and highlight colour as the words' own
// (black, and the usual web fonts, are left as the document's)
const GENERIC_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|arial|times new roman|calibri)$/i;
function keepLook(c, st, f) {
  const drop = (p) => { for (const k of [...f]) if (k.startsWith(p)) f.delete(k); };
  const col = (/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(st) || [])[1] || (c.tagName === "FONT" && c.getAttribute("color"));
  const hx = col && hexOf(col.trim());
  if (hx) { drop("c:"); if (hx !== "000000") f.add("c:" + hx); }
  const fam = (/font-family\s*:\s*([^;]+)/i.exec(st) || [])[1] || (c.tagName === "FONT" && c.getAttribute("face"));
  if (fam) {
    const name = fam.split(",")[0].replace(/["']/g, "").replace(/&quot;/g, "").trim();
    if (name && !GENERIC_FONTS.test(name)) { drop("font:"); f.add("font:" + name.slice(0, 60)); }
  }
  const fs = /font-size\s*:\s*([\d.]+)\s*(pt|px)/i.exec(st);
  if (fs) {
    const pt = fs[2].toLowerCase() === "px" ? +fs[1] * 0.75 : +fs[1];
    if (pt >= 4 && pt <= 200) { drop("sz:"); f.add("sz:" + Math.round(pt * 2)); }
  }
  const bg = (/background(?:-color)?\s*:\s*([^;]+)/i.exec(st) || [])[1];
  if (bg && f.has("h")) { const n = nearestHl(bg.trim()); if (n && n !== "yellow") { drop("hc:"); f.add("hc:" + n); } }
}

// HTML from another program or a web page: lines, keeping bold, italic,
// underline, strikethrough, highlight, links, headings, lists and quotes
// (RossDraft 1.11.0) keep: Paste Special ▸ Keep Source Formatting: its colours, fonts and sizes too
export function linesFromHtml(html, keep) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  let cur = null;
  const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR",
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "UL", "OL", "TABLE", "TBODY", "DD", "DT", "FIGURE"]);
  const newLine = (kind) => { cur = { kind: kind || null, runs: [] }; out.push(cur); };
  const walk = (n, f, href, kind) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.data.replace(/\s+/g, " ");
        if (!t.trim() && (!cur || !cur.runs.length)) continue;
        if (!cur) newLine(kind);
        cur.runs.push({ t, f: new Set(f), href });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "HEAD" || t === "TITLE" || t === "META") continue;
      if (t === "BR") { newLine(kind === "ul" || kind === "ol" ? null : kind === "quote" ? "quote" : null); continue; }
      if (t === "IMG" || (t === "SUP" && c.classList.contains("fnref"))) continue;   // (a note's mark isn't pasted)
      const f2 = new Set(f);
      let href2 = href, kind2 = kind;
      if (t === "B" || t === "STRONG") f2.add("b");
      if (t === "I" || t === "EM") f2.add("i");
      if (t === "U") f2.add("u");
      if (t === "S" || t === "STRIKE" || t === "DEL") f2.add("s");
      if (t === "MARK") f2.add("h");
      if ((t === "SUP" || t === "SUB") && !f2.has("sup") && !f2.has("sub")) f2.add(t.toLowerCase());
      const st = c.getAttribute("style") || "";
      if (/vertical-align\s*:\s*super/i.test(st) && !f2.has("sub")) f2.add("sup");
      if (/vertical-align\s*:\s*sub/i.test(st) && !f2.has("sup")) f2.add("sub");
      if (keep) keepLook(c, st, f2);
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) f2.add("b");
      if (/font-style\s*:\s*italic/i.test(st)) f2.add("i");
      if (/text-decoration[^;]*underline/i.test(st)) f2.add("u");
      if (/text-decoration[^;]*line-through/i.test(st)) f2.add("s");
      if (/background(-color)?\s*:\s*(?!transparent|rgba\(0,\s*0,\s*0,\s*0\)|#fff\b|#ffffff|white|initial|inherit|none)/i.test(st)) f2.add("h");
      if (t === "A" && c.getAttribute("href") && /^(https?|mailto|file|ftp):/i.test(c.getAttribute("href"))) href2 = c.getAttribute("href");
      if (/^H[1-6]$/.test(t)) kind2 = "h" + Math.min(3, +t[1]);
      if (t === "LI") kind2 = c.parentNode && c.parentNode.tagName === "OL" ? "ol" : "ul";
      if (t === "BLOCKQUOTE") kind2 = "quote";
      if (BLOCKS.has(t)) {
        if (t !== "UL" && t !== "OL" && t !== "TABLE" && t !== "TBODY") {
          newLine(kind2);
          // a paragraph's or heading's own alignment (from Word or Ross Writer; not a web page's layout)
          if (t === "P" || /^H[1-6]$/.test(t)) {
            const a = ((/text-align\s*:\s*([a-z-]+)/i.exec(st) || [])[1] || c.getAttribute("align") || "").toLowerCase();
            const al = { center: "center", right: "right", end: "right", justify: "justify" }[a];
            if (al) cur.align = al;
          }
        }
        walk(c, f2, href2, kind2);
        cur = null;
      } else walk(c, f2, href2, kind2);
    }
  };
  walk(doc.body, new Set(), null, null);
  // tidy: no empty lines from markup, spaces trimmed at the ends
  const lines = out.filter((ln) => ln.runs.some((r) => r.t.trim()));
  for (const ln of lines) {
    if (ln.runs.length) {
      ln.runs[0].t = ln.runs[0].t.replace(/^\s+/, "");
      ln.runs[ln.runs.length - 1].t = ln.runs[ln.runs.length - 1].t.replace(/\s+$/, "");
    }
    if (ln.kind && ln.kind[0] === "h") for (const r of ln.runs) r.f.delete("b");
  }
  return lines;
}

export { HL };
