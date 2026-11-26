// Word documents (.docx) in and out, the same way as the laptop's wordio.py.
// In: a .docx becomes lines (md.js's line model); out: lines become a .docx.
// Only loaded when you import or export, so the app stays quick to open.
import * as md from "./md.js?v=1.9.22-d1.15.0";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A_ = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const DC = "http://purl.org/dc/elements/1.1/";
const OBJ = md.OBJ;
// RossDraft 1.2: a footnote's or endnote's mark in the text: "\uE000f17\uE001" (f footnote, e endnote, then the
// note's id in the Word file). The page shows it as its number; the note's words are the scene's (fnotes).
export const NOTE_A = "\uE000", NOTE_Z = "\uE001";
export const NOTE_RE = /\uE000([fe])(-?\d+)\uE001/g;
export const noteToken = (kind, id) => NOTE_A + (kind === "endnote" || kind === "e" ? "e" : "f") + id + NOTE_Z;

// ================================================================ zip
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// name -> async () => Uint8Array
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip file");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const data = b.subarray(start, start + csize);
    out.set(name, method === 0 ? async () => data : async () => inflate(data));
  }
  return out;
}

export async function zip(files) {   // [[name, Uint8Array|string, compress]]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content, compress] of files) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(raw);
    const data = compress ? await deflate(raw) : raw;
    const nb = enc.encode(name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, compress ? 8 : 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, compress ? 8 : 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, x) => a + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ================================================================ reading
const kids = (el, local) => [...el.children].filter((c) => c.namespaceURI === W && (!local || c.localName === local));
const kid = (el, local) => el && kids(el, local)[0] || null;
const wv = (el, name = "val") => el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) : null;

function on(rpr, tag) {
  const e = kid(rpr, tag);
  if (!e) return null;
  const v = wv(e);
  return !["0", "false", "off", "none"].includes(v);
}

class Styles {
  constructor(doc) {
    this.byId = new Map();
    if (!doc) return;
    for (const s of kids(doc.documentElement, "style")) {
      const ppr = kid(s, "pPr"), rpr = kid(s, "rPr");
      let outline = null, num = null;
      if (ppr) {
        const o = kid(ppr, "outlineLvl");
        if (o && /^\d+$/.test(wv(o) || "")) outline = +wv(o);
        const np = kid(ppr, "numPr");
        if (np && kid(np, "numId")) num = [wv(kid(np, "numId")), kid(np, "ilvl") ? +wv(kid(np, "ilvl")) || 0 : 0];
      }
      const sid = wv(s, "styleId");
      this.byId.set(sid, {
        name: (wv(kid(s, "name")) || sid || "").toLowerCase(), based: kid(s, "basedOn") ? wv(kid(s, "basedOn")) : null,
        outline, num, b: on(rpr, "b"), i: on(rpr, "i"),
      });
    }
  }
  chain(sid) {
    const seen = [];
    while (sid && this.byId.has(sid) && !seen.includes(sid)) { seen.push(sid); sid = this.byId.get(sid).based; }
    return seen.map((s) => this.byId.get(s));
  }
  kind(sid) {
    if (!sid) return null;
    for (const st of this.chain(sid)) {
      const n = st.name;
      const m = /^heading\s*(\d)$/.exec(n);
      if (m) return "h" + Math.min(6, Math.max(1, +m[1]));
      if (n === "title") return "title";
      if (n === "subtitle") return "h2";
      if (["quote", "intense quote", "block text", "quotations", "block quotation"].includes(n)) return "quote";
      if (n.startsWith("list bullet")) return "ul";
      if (n.startsWith("list number")) return "ol";
      if (["html preformatted", "code", "preformatted text", "source code", "macro text"].includes(n)) return "code";
      if (st.outline != null && st.outline < 6) return "h" + (st.outline + 1);
    }
    const m = /^heading(\d)$/.exec(sid.toLowerCase());
    return m ? "h" + +m[1] : null;
  }
  listDepth(sid) {
    for (const st of this.chain(sid)) {
      const m = /^list (bullet|number)\s*(\d)$/.exec(st.name);
      if (m) return +m[2];
    }
    return 1;
  }
  num(sid) { for (const st of this.chain(sid)) if (st.num) return st.num; return null; }
  flags(sid) {
    const f = new Set();
    for (const st of this.chain(sid).reverse()) {
      for (const k of ["b", "i"]) { if (st[k] === true) f.add(k); else if (st[k] === false) f.delete(k); }
    }
    return f;
  }
}

class Numbering {
  constructor(doc) {
    this.abstract = new Map();
    this.nums = new Map();
    if (!doc) return;
    for (const a of kids(doc.documentElement, "abstractNum")) {
      const lv = new Map();
      for (const l of kids(a, "lvl")) lv.set(+(wv(l, "ilvl") || 0), kid(l, "numFmt") ? wv(kid(l, "numFmt")) : "bullet");
      this.abstract.set(wv(a, "abstractNumId"), lv);
    }
    for (const n of kids(doc.documentElement, "num")) {
      if (kid(n, "abstractNumId")) this.nums.set(wv(n, "numId"), wv(kid(n, "abstractNumId")));
    }
  }
  kind(id, ilvl) {
    if (id == null || id === "0") return null;
    const lv = this.abstract.get(this.nums.get(id)) || new Map();
    const fmt = lv.has(ilvl) ? lv.get(ilvl) : lv.get(0) || "bullet";
    return fmt === "bullet" || fmt === "none" ? "ul" : "ol";
  }
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");

// RossDraft 1.9.0: a document's usual look — the font, size and colour most of its words have of their own, and
// the line spacing most of its paragraphs have of their own (null: none of their own). Words that differ carry it
// (font:, sz:, c:); paragraphs that differ carry ls. wordpatch has the same reckoning.
export function usualLook(body) {
  const tally = { font: new Map(), sz: new Map(), color: new Map(), line: new Map(), lang: new Map() };
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  const val = (el, a = "val") => (el ? el.getAttributeNS(W, a) || el.getAttribute("w:" + a) : null);
  for (const p of body.getElementsByTagNameNS(W, "p")) {
    const ppr = [...p.children].find((c) => c.localName === "pPr");
    const sp = ppr && [...ppr.children].find((c) => c.localName === "spacing");
    const rule = sp && val(sp, "lineRule");
    add(tally.line, sp && val(sp, "line") && (!rule || rule === "auto") ? val(sp, "line") : null, 1);
  }
  for (const r of body.getElementsByTagNameNS(W, "r")) {
    let n = 0;
    for (const t of r.getElementsByTagNameNS(W, "t")) n += t.textContent.length;
    if (!n) continue;
    const rpr = [...r.children].find((c) => c.localName === "rPr");
    const k = (name) => rpr && [...rpr.children].find((c) => c.localName === name);
    const rf = k("rFonts");
    add(tally.font, rf ? val(rf, "ascii") || val(rf, "hAnsi") : null, n);
    add(tally.sz, k("sz") ? val(k("sz")) : null, n);
    const c = k("color") && val(k("color"));
    add(tally.color, c && c !== "auto" ? c.toUpperCase() : null, n);
    const lg = k("lang") && val(k("lang"));             // (RossDraft 1.15.0) the language most words are marked in
    add(tally.lang, lg || null, n);
  }
  const top = (m) => { let best = null, bn = -1; for (const [k, n] of m) if (n > bn) { best = k; bn = n; } return best; };
  return { font: top(tally.font), sz: top(tally.sz), color: top(tally.color), line: top(tally.line), lang: top(tally.lang) };
}

async function relsOf(files, path) {
  const out = new Map();
  if (!files.has(path)) return out;
  const d = xml(new TextDecoder().decode(await files.get(path)()));
  for (const r of d.getElementsByTagNameNS(PR, "Relationship")) out.set(r.getAttribute("Id"), [r.getAttribute("Target"), r.getAttribute("TargetMode")]);
  return out;
}

function tidyRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !r.img && !last.img && sameSet(last.f, r.f) && (last.href || null) === (r.href || null)) last.t += r.t;
    else out.push({ ...r, f: new Set(r.f) });
  }
  if (out.length && !out[0].img) out[0].t = out[0].t.replace(/^\s+/, "");
  if (out.length && !out[out.length - 1].img) out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, "");
  return out.filter((r) => r.t || r.img);
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// {lines (wordio's: kind, depth, runs, code, title), media: Map(name -> Uint8Array), title}
// opts.keep (a Ross Writer scene): every line as it is (no empty lines taken out), each with .src, the
// place of its paragraph in the body, so a scene can be written back with the untouched paragraphs as they were
export async function readDocx(buf, opts = {}) {
  const files = opts.files || await unzip(buf);
  const text = async (p) => (files.has(p) ? new TextDecoder().decode(await files.get(p)()) : null);
  const docText = await text("word/document.xml");
  if (!docText) throw new Error("not a Word document");
  const doc = xml(docText);
  const stylesText = await text("word/styles.xml"), numText = await text("word/numbering.xml");
  const styles = new Styles(stylesText ? xml(stylesText) : null);
  const numbering = new Numbering(numText ? xml(numText) : null);
  const rels = await relsOf(files, "word/_rels/document.xml.rels");
  let title = "";
  const core = await text("docProps/core.xml");
  if (core) { const t = xml(core).getElementsByTagNameNS(DC, "title")[0]; title = t ? t.textContent.trim() : ""; }
  const media = new Map();
  const lines = [];
  const pending = [];
  const bodyEl = doc.getElementsByTagNameNS(W, "body")[0];
  const usual = bodyEl ? usualLook(bodyEl) : { font: null, sz: null, color: null, line: null };
  let docLang = null;
  // (RossDraft 1.14.0) the usual paragraph's spacing from the styles too (Normal, or the document's defaults): the
  // line (240: single) and the space after it (twips), for where pages end
  {
    const sd = stylesText ? xml(stylesText) : null;
    const spOf = (el) => el && [...el.getElementsByTagNameNS(W, "spacing")][0];
    let defs = null, normal = null;
    if (sd) {
      defs = spOf([...sd.getElementsByTagNameNS(W, "pPrDefault")][0]);
      const ns = [...sd.getElementsByTagNameNS(W, "style")].find((s2) => wv(s2, "type") === "paragraph" && (wv(s2, "default") === "1" || wv(s2, "styleId") === "Normal"));
      normal = spOf(ns && kid(ns, "pPr"));
    }
    const pick = (a) => { for (const e of [normal, defs]) { const v = e && wv(e, a); if (v != null && /^\d+$/.test(v)) return +v; } return null; };
    const rule = (normal && wv(normal, "lineRule")) || (defs && wv(defs, "lineRule")) || "auto";
    usual.styleLine = rule === "auto" ? pick("line") : null;
    // (1.15.0) the document's language: its defaults' (or Normal's)
    if (sd) {
      const lgOf = (el) => { const l = el && [...el.getElementsByTagNameNS(W, "lang")][0]; return l && wv(l, "val"); };
      docLang = lgOf([...sd.getElementsByTagNameNS(W, "rPrDefault")][0]) || null;
    }
    usual.docLang = docLang;
    // the space after most paragraphs: their own, or the style's
    const tally = new Map();
    for (const p of bodyEl ? kids(bodyEl, "p") : []) {
      const sp = kid(kid(p, "pPr"), "spacing");
      const v = sp && wv(sp, "after");
      const k = v != null && /^\d+$/.test(v) ? +v : "style";
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    let best = "style", bn = -1;
    for (const [k, n] of tally) if (n > bn) { best = k; bn = n; }
    usual.after = best === "style" ? pick("after") || 0 : best;
  }
  // (RossDraft 1.12.0) tracked changes, in the order they come: id -> { id, kind, author, date, words }
  // kinds: ins, del (and moves), fmt (the words' formatting), pins / pdel (a paragraph's end added / taken out),
  // pfmt (a paragraph's settings), rowins / rowdel, tfmt (a table's, a row's or a cell's settings)
  const changes = new Map();
  const noteChange = (el, kind, words) => {
    const id = wv(el, "id");
    if (id == null) return null;
    let c = changes.get(id);
    if (!c) { c = { id, kind, author: wv(el, "author") || "", date: wv(el, "date") || "", words: "" }; changes.set(id, c); }
    if (words) c.words += words;
    return id;
  };

  const picture = (rid) => {
    const rel = rels.get(rid);
    if (!rel || rel[1] === "External" || !rel[0]) return null;
    let name = rel[0].startsWith("/") ? rel[0].slice(1) : "word/" + rel[0];
    name = name.replace(/[^/]+\/\.\.\//g, "");
    if (!files.has(name)) return null;
    const base = name.split("/").pop();
    pending.push(files.get(name)().then((d) => media.set(base, d)));
    return base;
  };

  // a run's look (bold, italic... its own colour, font, size) from its rPr into f; false: hidden text
  const lookOf = (rpr, f, href) => {
        const rs = kid(rpr, "rStyle");
        if (rs) {
          const cs = wv(rs) || "";
          const nm = (styles.byId.get(cs) || {}).name || cs.toLowerCase();
          if (nm === "strong" || nm === "bold" || styles.flags(cs).has("b")) f.add("b");
          if (nm === "emphasis" || nm === "italic" || styles.flags(cs).has("i")) f.add("i");
        }
        for (const [k, tag] of [["b", "b"], ["i", "i"], ["s", "strike"], ["s", "dstrike"]]) {
          const v = on(rpr, tag);
          if (v === true) f.add(k);
          else if (v === false && (tag === "b" || tag === "i")) f.delete(k);
        }
        const u = kid(rpr, "u");
        if (u && !["none", "0"].includes(wv(u) || "single") && !href) f.add("u");
        const hl = kid(rpr, "highlight");
        if (hl && !["none", "white"].includes(wv(hl) || "none")) f.add("h");
        const shd = kid(rpr, "shd");
        if (shd && !["auto", "ffffff", "none", ""].includes((wv(shd, "fill") || "auto").toLowerCase())) f.add("h");
        const va = kid(rpr, "vanish");
        if (va && !["0", "false"].includes(wv(va) || "true")) return false;
        // (1.9.0) its own look where it differs from the document's usual
        if (hl && f.has("h") && !["yellow", "none", "white"].includes(wv(hl) || "yellow")) f.add("hc:" + wv(hl));
        const col = kid(rpr, "color") && wv(kid(rpr, "color"));
        if (col && col !== "auto" && /^[0-9A-Fa-f]{6}$/.test(col) && col.toUpperCase() !== usual.color && !href) f.add("c:" + col.toUpperCase());
        const vs = kid(rpr, "vertAlign") && wv(kid(rpr, "vertAlign"));
        if (vs === "superscript") f.add("sup"); else if (vs === "subscript") f.add("sub");
        const rf = kid(rpr, "rFonts");
        const fn = rf && (wv(rf, "ascii") || wv(rf, "hAnsi"));
        if (fn && fn !== usual.font && !/["<>]/.test(fn)) f.add("font:" + fn);
        const sz = kid(rpr, "sz") && wv(kid(rpr, "sz"));
        if (sz && /^\d+$/.test(sz) && sz !== usual.sz) f.add("sz:" + sz);
        // (RossDraft 1.15.0) words in another language than most ("lang:fr-FR"), or not checked ("lang:zxx")
        const np = kid(rpr, "noProof");
        const lg = kid(rpr, "lang") && wv(kid(rpr, "lang"));
        if (np && !["0", "false"].includes(wv(np) || "true")) f.add("lang:zxx");
        else if (lg && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lg) && lg.toLowerCase() !== (usual.lang || docLang || "").toLowerCase()) f.add("lang:" + lg);
    return true;
  };
  // (RossDraft 1.13.0) a field (page number, date, a cross-reference...): one run showing its result, flagged
  // "fld:<its instruction, URI-encoded>"; a HYPERLINK field: its words a link. A form field, a field in a field, or
  // one across paragraphs (a contents list made by Word): its words shown, the scene read-only.
  // (RossDraft 1.14.0) a contents list (Word's TOC field, across paragraphs): its paragraphs' lines are marked
  // toc: "<level>" + "s" (its first) / "e" (its last); shown as they are, not typed in
  let tocState = null;
  const fieldRun = (instr, runs, f0, href) => {
    const ins = (instr || "").trim();
    const hl = /^HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(ins);
    if (hl) return runs.filter(Boolean).map((r) => ({ ...r, href: r.href || (/\\l/.test(ins) ? null : hl[1]) }));
    const text = runs.filter((r) => r && r.t && !r.img).map((r) => r.t).join("").replace(/\n/g, " ");
    const f = new Set((runs.find((r) => r && r.f) || {}).f || f0 || []);
    for (const k of [...f]) if (k.startsWith("fld:")) f.delete(k);
    f.add("fld:" + encodeURIComponent(ins || "PAGE"));
    return [{ t: text || "[" + (ins.split(/\s+/)[0] || "FIELD").toUpperCase() + "]", f, href }];
  };
  const runsOf = (p, paraFlags, heading, out0) => {
    // (1.13.0) the field being read (Word's begin / instruction / separate / result / end)
    const fs = { depth: 0, instr: "", res: [], mode: "instr", f: null, odd: false };
    const out = { push: (x) => (fs.depth > 0 ? (fs.mode === "res" || fs.depth > 1 ? fs.res.push(x) : 0) : out0.push(x)) };
    const run = (r, href, tc) => {
      const rpr = kid(r, "rPr");
      const f = new Set(paraFlags);
      if (tc) f.add(tc.key);
      if (rpr) {
        if (lookOf(rpr, f, href) === false) return;
        // (1.12.0) its formatting changed, with changes tracked
        const rc = kid(rpr, "rPrChange");
        if (rc) {
          const id = noteChange(rc, "fmt", [...r.getElementsByTagNameNS(W, "t")].map((x) => x.textContent).join(""));
          if (id != null) {
            f.add("tf:" + id);
            // (its look before: for Review ▸ Original)
            const c = changes.get(id);
            if (c && !c.old) { const of = new Set(paraFlags); lookOf(kid(rc, "rPr"), of, href); if (heading) of.delete("b"); c.old = [...of]; }
          }
        }
      }
      if (tc) noteChange(tc.el, tc.kind, [...r.getElementsByTagNameNS(W, tc.kind === "del" ? "delText" : "t")].map((x) => x.textContent).join(""));
      if (heading) f.delete("b");
      for (const c of r.children) {
        if (c.namespaceURI === W) {
          const t = c.localName;
          if (t === "fldChar") {
            const ty = wv(c, "fldCharType");
            if (ty === "begin") {
              if (fs.depth === 0) Object.assign(fs, { instr: "", res: [], mode: "instr", f: new Set(f), odd: false, href });
              else if (!/^\s*TOC\b/i.test(fs.instr)) fs.odd = "a field inside a field";    // (a contents list's page numbers are fields)
              if (kid(c, "ffData")) fs.odd = "a form field";
              fs.depth++;
            } else if (ty === "separate" && fs.depth === 1) fs.mode = "res";
            else if (ty === "end" && fs.depth === 0 && tocState && tocState.open) tocState.endHere = true;
            else if (ty === "end" && fs.depth > 0) {
              fs.depth--;
              if (fs.depth === 0) {
                if (fs.odd) { trouble.add(fs.odd); for (const x of fs.res) out0.push(x); }
                else for (const x of fieldRun(fs.instr, fs.res, fs.f, fs.href)) out0.push(x);
              }
            }
            continue;
          }
          if (t === "instrText") { if (fs.depth === 1 && fs.mode === "instr") fs.instr += c.textContent; continue; }
          if (t === "t" || (t === "delText" && tc && tc.kind === "del")) { if (c.textContent) out.push({ t: c.textContent, f: new Set(f), href }); }
          else if (t === "footnoteReference" || t === "endnoteReference") out.push({ t: noteToken(t[0], wv(c, "id")), f: new Set(f), href });
          else if (t === "tab" || t === "ptab") out.push({ t: (tocState && tocState.open) || (fs.depth > 0 && /^\s*TOC\b/i.test(fs.instr)) ? "\t" : " ", f: new Set(f), href });
          else if (t === "br" || t === "cr") { if (wv(c, "type") !== "page") out.push(null); }
          else if (t === "noBreakHyphen") out.push({ t: "-", f: new Set(f), href });
          else if (t === "drawing") {
            for (const b of c.getElementsByTagNameNS(A_, "blip")) {
              const name = picture(b.getAttributeNS(R, "embed"));
              if (name) out.push({ t: OBJ, f: new Set(), img: name });
            }
          } else if (t === "pict" || t === "object") {
            for (const im of c.getElementsByTagNameNS(V, "imagedata")) {
              const name = picture(im.getAttributeNS(R, "id"));
              if (name) out.push({ t: OBJ, f: new Set(), img: name });
            }
          }
        }
      }
    };
    // (1.12.0) tc: the tracked change the runs are in ({ key: "ti:5" / "td:5", kind, el })
    const walk = (el, href, tc) => {
      for (const c of el.children) {
        if (c.namespaceURI !== W) continue;
        const t = c.localName;
        if (t === "r") run(c, href, tc);
        else if (t === "hyperlink") {
          const rid = c.getAttributeNS(R, "id");
          const h = rid && rels.get(rid) ? rels.get(rid)[0] : null;
          walk(c, h || href, tc);
        } else if (t === "ins" || t === "moveTo") walk(c, href, wv(c, "id") != null ? { key: "ti:" + wv(c, "id"), kind: "ins", el: c } : tc);
        else if (t === "del" || t === "moveFrom") walk(c, href, wv(c, "id") != null ? { key: "td:" + wv(c, "id"), kind: "del", el: c } : tc);
        else if (t === "fldSimple") {
          // (1.13.0) its result's runs made the field's one run
          const sub = [];
          const keep = out0;
          const at = keep.length;
          walk(c, href, tc);
          sub.push(...keep.splice(at));
          for (const x of fieldRun(wv(c, "instr"), sub, null, href)) keep.push(x);
        }
        else if (["smartTag", "customXml"].includes(t)) walk(c, href, tc);
        else if (t === "sdt") { const sc = kid(c, "sdtContent"); if (sc) walk(sc, href, tc); }
      }
    };
    walk(p, null, null);
    if (fs.depth > 0) {
      if (/^\s*TOC\b/i.test(fs.instr) && fs.depth === 1) {
        // (1.14.0) a contents list starts here
        tocState = { open: true, startHere: true, endHere: false };
      } else trouble.add("a field across paragraphs");
      for (const x of fs.res) out0.push(x);
    }
  };

  const olAt = new Map();      // (1.7.0) the Word list each level's numbered items were last in
  const paragraph = (p) => {
    const ppr = kid(p, "pPr");
    let sid = null, num = null, align = null;
    if (ppr) {
      sid = kid(ppr, "pStyle") ? wv(kid(ppr, "pStyle")) : null;
      // the paragraph's own alignment (Word's both / distribute: justified; end: right)
      if (kid(ppr, "jc")) align = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" }[wv(kid(ppr, "jc"))] || null;
      const np = kid(ppr, "numPr");
      if (np && kid(np, "numId")) num = [wv(kid(np, "numId")), kid(np, "ilvl") ? +wv(kid(np, "ilvl")) || 0 : 0];
    }
    // (1.9.0) its own line spacing (where it differs from the usual), Start on New Page, a page break before it
    let ls = null, newPage = false, brk = false;
    if (ppr) {
      const sp = kid(ppr, "spacing");
      const line = sp && wv(sp, "line"), rule = sp && wv(sp, "lineRule");
      if (line && (!rule || rule === "auto") && line !== usual.line) ls = String(Math.round(+line / 240 * 100) / 100);
      const pb = kid(ppr, "pageBreakBefore");
      if (pb && !["0", "false", "off"].includes(wv(pb) || "true")) newPage = true;
    }
    {
      const r0 = kids(p, "r")[0];
      if (r0) {
        const ks = kids(r0).filter((c) => c.localName !== "rPr" && c.localName !== "lastRenderedPageBreak");
        if (ks.length === 1 && ks[0].localName === "br" && wv(ks[0], "type") === "page") brk = true;
      }
    }
    let kind = styles.kind(sid);
    if (num == null && sid) num = styles.num(sid);
    let depth = kind === "ul" || kind === "ol" ? styles.listDepth(sid) : 1;
    if (num != null) {
      const lk = numbering.kind(num[0], num[1]);
      if (lk && !(kind && kind[0] === "h" || kind === "title")) {
        depth = Math.max(num[1] + 1, kind === "ul" || kind === "ol" ? depth : 1);
        kind = lk;
      }
    }
    const isTitle = kind === "title";
    if (isTitle) kind = "h1";
    const heading = !!kind && kind[0] === "h";
    const code = kind === "code";
    if (code) kind = null;
    // (1.12.0) its end added or taken out, its settings changed, with changes tracked
    const tcp = [];
    if (ppr) {
      const mrp = kid(ppr, "rPr");
      for (const [tag, k, c] of [["ins", "pins", "i"], ["moveTo", "pins", "i"], ["del", "pdel", "d"], ["moveFrom", "pdel", "d"]]) {
        const e = mrp && kid(mrp, tag);
        if (e) { const id = noteChange(e, k, ""); if (id != null) tcp.push(c + id); }
      }
      const pc = kid(ppr, "pPrChange");
      if (pc) {
        const id = noteChange(pc, "pfmt", "");
        if (id != null) {
          tcp.push("f" + id);
          // (its alignment before: for Review ▸ Original)
          const c = changes.get(id), jc = kid(kid(pc, "pPr"), "jc");
          if (c && !("oldAlign" in c)) c.oldAlign = jc ? { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" }[wv(jc)] || null : null;
        }
      }
    }
    const out = [];
    runsOf(p, sid && !heading && kind !== "quote" ? styles.flags(sid) : new Set(), heading, out);
    const parts = [[]];
    for (const r of out) { if (r === null) parts.push([]); else parts[parts.length - 1].push(r); }
    // (RossDraft 1.7.0) a numbered item in another of Word's lists than the one before it at its level: a fresh
    // start (Restart Numbering), unless its list's start says it goes on
    let restart = false;
    if (kind === "ol" && num != null) {
      const prev = olAt.get(depth);
      if (prev != null && prev !== num[0]) restart = true;
      olAt.set(depth, num[0]);
      for (const d of [...olAt.keys()]) if (d > depth) olAt.delete(d);
    } else if (kind !== "ul" && kind !== "ol") olAt.clear();
    const res = parts.map((runs, k) => ({
      kind: k === 0 || kind === "quote" ? kind : (kind === "ul" || kind === "ol" || heading ? null : kind),
      restart: k === 0 && restart,
      depth, runs: tidyRuns(runs), code, title: isTitle && k === 0, align: code ? null : align,
      ls: code ? null : ls, pageBreak: k === 0 && newPage, brk: k === 0 && brk,
      tcp: k === parts.length - 1 && tcp.length ? tcp.join(" ") : null,
    }));
    if (tocState && tocState.open) {
      // (1.14.0) a line of a contents list: its level (Word's TOC 1, TOC 2…), its first and last
      const nm = ((styles.byId.get(sid) || {}).name || sid || "").toLowerCase();
      const lv = (/^toc ?(\d)/.exec(nm) || [])[1] || "1";
      const fin = res.length ? res : [];
      fin.forEach((ln, k) => { ln.toc = lv + (tocState.startHere && k === 0 ? "s" : "") + (tocState.endHere && k === fin.length - 1 ? "e" : ""); ln.kind = null; });
      tocState.startHere = false;
      if (tocState.endHere) tocState = null;
    }
    return res;
  };

  // RossDraft 1.8.0: a table as one line, its cells' paragraphs with their formatting, as Ross Writer shows it;
  // one RossDraft can't write back (merged cells, a table in a table) as before: rows of words, and said so
  const trouble = new Set();
  const tableChanges = (tb) => {
    for (const e of tb.getElementsByTagNameNS(W, "*")) {
      const l = e.localName, up = e.parentNode && e.parentNode.localName;
      if ((l === "ins" || l === "del") && up === "trPr") noteChange(e, l === "ins" ? "rowins" : "rowdel", "");
      else if (l === "tblPrChange" || l === "trPrChange" || l === "tcPrChange" || l === "tblGridChange") noteChange(e, "tfmt", "");
    }
  };
  const table = (tb, idx) => {
    tableChanges(tb);
    const nested = [...tb.getElementsByTagNameNS(W, "tc")].some((tc) => tc.getElementsByTagNameNS(W, "tbl").length);
    if (nested) trouble.add("a table inside a table");
    if (!nested) {
      // (RossDraft 1.13.0) merged cells: the cells laid out on the table's grid; one merged into the cell to its left
      // (Word's gridSpan, hMerge) or into the one above (vMerge) is covered: cover["row.col"] = "l" / "u"
      const cells = [], cover = {};
      const empty = () => [{ kind: null, runs: [] }];
      for (const tr of kids(tb, "tr")) {
        const r = cells.length;
        const row = [];
        const trPr = kid(tr, "trPr");
        const gb = trPr && kid(trPr, "gridBefore");
        for (let k = 0; k < (gb ? +wv(gb) || 0 : 0); k++) row.push(empty());
        for (const tc of kids(tr, "tc")) {
          const tcPr = kid(tc, "tcPr");
          const gs = Math.max(1, Math.min(63, +(kid(tcPr, "gridSpan") && wv(kid(tcPr, "gridSpan"))) || 1));
          const vm = kid(tcPr, "vMerge");
          const hm = kid(tcPr, "hMerge");
          const paras = [];
          for (const p of kids(tc, "p")) {
            for (const ln of paragraph(p)) {
              paras.push({ kind: null, runs: ln.runs.filter((x) => !x.img), align: ln.align || null });
            }
          }
          if (tc.getElementsByTagNameNS(W, "drawing").length || tc.getElementsByTagNameNS(W, "pict").length) trouble.add("a picture in a table");
          const col = row.length;
          row.push(paras.length ? paras : empty());
          if (vm && wv(vm) !== "restart" && r > 0) cover[r + "." + col] = "u";
          else if (hm && wv(hm) !== "restart" && col > 0) cover[r + "." + col] = "l";
          for (let k = 1; k < gs; k++) { cover[r + "." + row.length] = "l"; row.push(empty()); }
        }
        if (row.length) cells.push(row);
      }
      if (cells.length) {
        const w = Math.max(...cells.map((r) => r.length));
        for (const r of cells) while (r.length < w) r.push([{ kind: null, runs: [] }]);
        // a cell "merged into the one above" where there's nothing above to merge into: a cell of its own
        for (const k of Object.keys(cover)) {
          const [r, c] = k.split(".").map(Number);
          if (cover[k] === "u" && (r === 0 || cover[(r - 1) + "." + c] === "l")) delete cover[k];
          if (cover[k] === "l" && c === 0) delete cover[k];
        }
        const bd = kid(kid(tb, "tblPr"), "tblBorders");
        const off = (e) => ["none", "nil"].includes(e.getAttributeNS(W, "val") || e.getAttribute("w:val"));
        // (no lines of its own and no table style: Word shows none)
        const noLines = bd ? kids(bd).length > 0 && kids(bd).every(off) : !kid(kid(tb, "tblPr"), "tblStyle");
        const ln = { kind: "table", runs: [], cells, noLines, code: false, depth: 1 };
        if (Object.keys(cover).length) ln.cover = cover;
        const gw = kids(kid(tb, "tblGrid"), "gridCol").map((g) => parseInt(g.getAttributeNS(W, "w") || g.getAttribute("w:w") || "0", 10));
        if (gw.length === w && gw.every((x) => x > 0)) ln.widths = gw;
        if (idx != null) ln.src = idx;
        lines.push(ln);
        return;
      }
    }
    const rows = [];
    for (const tr of kids(tb, "tr")) {
      const cells = [];
      for (const tc of kids(tr, "tc")) {
        const txt = [];
        for (const p of tc.getElementsByTagNameNS(W, "p")) {
          for (const ln of paragraph(p)) {
            const t = ln.runs.filter((r) => !r.img).map((r) => r.t).join("").trim();
            if (t) txt.push(t);
          }
        }
        cells.push(txt.join(" ").replace(/\|/g, "\\|"));
      }
      rows.push(cells);
    }
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((r, k) => {
      r = [...r, ...Array(width - r.length).fill("")];
      lines.push({ kind: null, depth: 1, runs: [{ t: "| " + r.join(" | ") + " |", f: new Set() }], code: true });
      if (k === 0) lines.push({ kind: null, depth: 1, runs: [{ t: "|" + Array(width).fill(" --- ").join("|") + "|", f: new Set() }], code: true });
    });
  };

  const block = (el, top) => {
    [...el.children].forEach((c, idx) => {
      if (c.namespaceURI !== W) return;
      if (c.localName === "p") {
        const ls = paragraph(c);
        if (top) ls.forEach((ln) => { ln.src = idx; });
        lines.push(...ls);
      } else if (c.localName === "tbl") table(c, top ? idx : null);
      else if (c.localName === "sdt") {
        // (1.14.0: kept whole when nothing in it changes, a contents list's content control say)
        const sc = kid(c, "sdtContent");
        if (sc) { const at = lines.length; block(sc); if (top) for (let k = at; k < lines.length; k++) lines[k].src = idx; }
      }
      else if (c.localName === "ins" || c.localName === "customXml") block(c);
    });
  };
  const body = kid(doc.documentElement, "body");
  if (body) block(body, true);
  await Promise.all(pending);
  // the footnotes' and endnotes' words (separators left out), each note's paragraphs on lines of their own
  const notes = new Map();
  for (const [kind, part] of [["f", "word/footnotes.xml"], ["e", "word/endnotes.xml"]]) {
    const t = await text(part);
    if (!t) continue;
    for (const n of xml(t).getElementsByTagNameNS(W, kind === "f" ? "footnote" : "endnote")) {
      const ty = n.getAttributeNS(W, "type") || n.getAttribute("w:type");
      if (ty === "separator" || ty === "continuationSeparator" || ty === "continuationNotice") continue;
      const paras = [...n.getElementsByTagNameNS(W, "p")].map((p) => {
        let s = "";
        for (const el of p.getElementsByTagNameNS(W, "*")) {
          if (el.localName === "t") s += el.textContent;
          else if (el.localName === "tab") s += " ";
        }
        return s;
      });
      notes.set(kind + (n.getAttributeNS(W, "id") || n.getAttribute("w:id")), paras.join("\n").replace(/^\s+/, ""));
    }
  }
  // (RossDraft 1.14.0) the page: its size and margins (twips), from the last section
  let page = null;
  {
    const secs = bodyEl ? kids(bodyEl, "sectPr") : [];
    const sp = secs[secs.length - 1];
    const num = (el, a, d) => { const v = el && wv(el, a); return v != null && /^-?\d+$/.test(v) ? +v : d; };
    const sz = sp && kid(sp, "pgSz"), mar = sp && kid(sp, "pgMar");
    page = { w: num(sz, "w", 11906), h: num(sz, "h", 16838), landscape: !!(sz && wv(sz, "orient") === "landscape"),
      top: Math.abs(num(mar, "top", 1440)), bottom: Math.abs(num(mar, "bottom", 1440)), left: num(mar, "left", 1440), right: num(mar, "right", 1440),
      header: num(mar, "header", 708), footer: num(mar, "footer", 708) };
  }
  if (opts.keep) return { lines, media, title, files, docText, notes, trouble: [...trouble], usual, changes: [...changes.values()], page };
  const tidy = [];
  for (const ln of lines) {
    const empty = !ln.runs.some((r) => r.t.trim()) && !ln.kind && !ln.cells;
    if (empty && (!tidy.length || tidy[tidy.length - 1]._empty)) continue;
    ln._empty = empty;
    tidy.push(ln);
  }
  while (tidy.length && tidy[tidy.length - 1]._empty) tidy.pop();
  for (const ln of tidy) delete ln._empty;
  return { lines: tidy, media, title };
}

export function splitSections(lines) {
  const levels = lines.filter((l) => l.kind && l.kind[0] === "h" && !l.title).map((l) => +l.kind[1]);
  if (!levels.length) return { pre: lines, secs: [] };
  const top = "h" + Math.min(...levels);
  const pre = [], secs = [];
  for (const ln of lines) {
    if (ln.kind === top && !ln.title) secs.push([ln]);
    else if (secs.length) secs[secs.length - 1].push(ln);
    else pre.push(ln);
  }
  return { pre, secs };
}

// wordio lines -> md.js lines (lists deeper than one get a marker with their indent)
export function toNoteLines(lines, picture) {
  return lines.map((ln) => {
    if (ln.kind === "table" && ln.cells) {
      const out = { kind: "table", runs: [], cells: ln.cells.map((r) => r.map((c) => toNoteLines(c, picture).map((p) => ({ kind: null, runs: p.runs })))) };
      if (ln.noLines) out.noLines = true;
      if (ln.widths) out.widths = ln.widths.slice();
      if (ln.cover) out.cover = { ...ln.cover };          // (1.13.0) merged cells
      return out;
    }
    if (ln.code) {
      const t = ln.runs.map((r) => r.t).join("");
      return { kind: null, runs: [{ t, f: new Set() }], raw: t, code: true };
    }
    const out = { kind: ln.kind, mark: null, runs: [] };
    if (ln.align) out.align = ln.align;
    if (ln.ls) out.ls = ln.ls;                 // (1.9.0)
    if (ln.pageBreak) out.newpage = true;
    if (ln.brk) out.brk = true;
    if (ln.tcp) out.tcp = ln.tcp;              // (1.12.0)
    if (ln.toc) out.toc = ln.toc;              // (1.14.0)
    if ((ln.kind === "ul" || ln.kind === "ol") && ln.depth > 1) {
      const lead = "  ".repeat(ln.depth - 1);
      out.mark = ln.kind === "ul" ? "ul:" + lead + "- " : "ol:" + lead + "\u0000. ";
    }
    if (ln.kind === "ol" && ln.restart) out.restart = true;
    for (const r of ln.runs) {
      if (r.img) { const target = picture(r.img); if (target) out.runs.push({ t: OBJ, f: new Set(), img: { src: "", size: "", target } }); continue; }
      out.runs.push({ t: r.t.replace(/\n/g, " "), f: new Set(r.f), href: r.href || null });
    }
    return out;
  });
}

// md.js lines -> wordio lines
export function fromNoteLines(lines) {
  const { depthOf, restarts } = md.listLayout(lines);
  return lines.map((ln, k) => {
    if (ln.kind === "table" && ln.cells) {
      const cells = ln.cells.map((r) => r.map((c) => fromNoteLines(c.map((p) => ({ kind: null, runs: p.runs || [] })))
        .map((p) => ({ kind: null, depth: 1, code: false, align: null, restart: false, runs: p.runs }))));
      // (table: the rows' words, for the writers that only know those: RTF, e-book, print)
      return { kind: "table", depth: 1, code: false, runs: [], cells, noLines: !!ln.noLines, equal: !!ln.equal,
        widths: ln.widths && ln.widths.length ? ln.widths.slice() : null, cover: ln.cover ? { ...ln.cover } : null,
        table: cells.map((r) => r.map((c) => c.map((p) => p.runs.map((x) => x.t || "").join("")).join(" "))) };
    }
    if (ln.raw != null && (ln.code || ln.runs.map((r) => r.t).join("") === ln.raw)) {
      return { kind: null, depth: 1, code: !!ln.code, runs: [{ t: ln.runs.map((r) => r.t).join(""), f: new Set() }] };
    }
    const heading = !!ln.kind && ln.kind[0] === "h";
    return {
      kind: ln.kind, depth: depthOf[k] || 1, code: false, align: ln.align || null, restart: !!restarts[k],
      ls: ln.ls || null, pageBreak: !!ln.newpage || !!ln.pageBreak, brk: !!ln.brk, tcp: ln.tcp || null, toc: ln.toc || null,
      runs: ln.runs.map((r) => (r.img ? { t: OBJ, f: new Set(), img: r.img }
        : { t: r.t.split(OBJ).join(""), f: heading ? new Set([...r.f].filter((x) => x !== "b")) : r.f, href: r.href || null })),
    };
  });
}

// ================================================================ writing
const TEXT_WIDTH_EMU = 5760720;
const HEAD_PT = { 1: 20, 2: 16, 3: 14, 4: 12, 5: 12, 6: 12 };
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xa = (s) => x(s).replace(/"/g, "&quot;");

export const NOTE_STYLES =
  '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';

// a note's paragraphs (its words, a line each), the first starting with its number, as Word writes them
export function noteParasXml(kind, text, styled = true) {
  const k = kind === "e" || kind === "endnote" ? "endnote" : "footnote";
  const Ref = k === "footnote" ? "Footnote" : "Endnote";
  return String(text || "").split("\n").map((line, i) =>
    `<w:p>${styled ? `<w:pPr><w:pStyle w:val="${Ref}Text"/></w:pPr>` : ""}` +
    (i === 0 ? `<w:r><w:rPr>${styled ? `<w:rStyle w:val="${Ref}Reference"/>` : '<w:vertAlign w:val="superscript"/>'}</w:rPr><w:${k}Ref/></w:r>` : "") +
    `<w:r><w:t xml:space="preserve">${x(i === 0 ? " " + line.replace(/^\s+/, "") : line)}</w:t></w:r></w:p>`).join("");
}
export function emptyNotesXml(kind) {
  const k = kind === "e" || kind === "endnote" ? "endnote" : "footnote";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${k}s xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:${k} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${k}>` +
    `<w:${k} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${k}>` +
    `</w:${k}s>`;
}
// a run's words with its note marks: [{ t } | { note: [kind, id] }]
export function splitNotes(t) {
  const out = [];
  let at = 0;
  for (const m of String(t).matchAll(NOTE_RE)) {
    if (m.index > at) out.push({ t: t.slice(at, m.index) });
    out.push({ note: [m[1], m[2]] });
    at = m.index + m[0].length;
  }
  if (at < t.length) out.push({ t: t.slice(at) });
  return out;
}

function stylesXml(font, opts = {}) {
  const sz = opts.size || 24, line = opts.line || 276;
  const f = xa(font);
  let heads = "";
  for (let k = 1; k <= 6; k++) {
    heads += `<w:style w:type="paragraph" w:styleId="Heading${k}"><w:name w:val="heading ${k}"/><w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${k < 3 ? 240 : 160}" w:after="80"/>` +
      `<w:outlineLvl w:val="${k - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${HEAD_PT[k] * 2}"/><w:szCs w:val="${HEAD_PT[k] * 2}"/></w:rPr></w:style>`;
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles xmlns:w="${W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>` +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heads +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:ind w:left="567" w:right="284"/></w:pPr><w:rPr><w:color w:val="6B6145"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>' +
    '<w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:rPr><w:color w:val="1A5FB4"/><w:u w:val="single"/></w:rPr></w:style>' + NOTE_STYLES +
    "</w:styles>";
}

function numberingXml(nOrdered) {
  const lvls = (bullet) => {
    let out = "";
    for (let k = 0; k < 9; k++) {
      const ind = 720 * (k + 1);
      out += bullet
        ? `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${"•◦▪"[k % 3]}"/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="${["decimal", "lowerLetter", "lowerRoman"][k % 3]}"/><w:lvlText w:val="%${k + 1}."/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
    return out;
  };
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>';
  for (let k = 0; k < nOrdered; k++) {
    let ov = "";
    for (let i = 0; i < 9; i++) ov += `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="1"/></w:lvlOverride>`;
    nums += `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="2"/>${ov}</w:num>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}">` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>${nums}` +
    "</w:numbering>";
}

export function rpr(f, link) {
  let p = "";
  if (link) p += '<w:rStyle w:val="Hyperlink"/>';
  if (f.has("b")) p += "<w:b/><w:bCs/>";
  if (f.has("i")) p += "<w:i/><w:iCs/>";
  if (f.has("s")) p += "<w:strike/>";
  const v = (pre) => { const k = [...f].find((x2) => x2.startsWith(pre)); return k ? k.slice(pre.length) : null; };
  // (1.9.0) the words' own look; CT_RPr's order: rFonts, b, i, strike, color, sz, highlight, u, vertAlign
  const font = v("font:"), col = v("c:"), sz = v("sz:"), hc = v("hc:");
  if (font) p = `<w:rFonts w:ascii="${xa(font)}" w:hAnsi="${xa(font)}" w:cs="${xa(font)}"/>` + p;
  if (col) p += `<w:color w:val="${col}"/>`;
  if (sz) p += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
  if (f.has("h")) p += `<w:highlight w:val="${hc || "yellow"}"/>`;   // highlight before u: Word's order
  if (f.has("u") && !link) p += '<w:u w:val="single"/>';
  if (f.has("sup")) p += '<w:vertAlign w:val="superscript"/>'; else if (f.has("sub")) p += '<w:vertAlign w:val="subscript"/>';
  const lg = v("lang:");                                            // (1.15.0) lang last (CT_RPr's order); noProof after strike
  if (lg === "zxx") p = p.includes("<w:strike/>") ? p.replace("<w:strike/>", "<w:strike/><w:noProof/>") : p.replace(/^(<w:rFonts[^>]*\/>)?((?:<w:b\/><w:bCs\/>)?(?:<w:i\/><w:iCs\/>)?)/, (m) => m + "<w:noProof/>");
  else if (lg) p += `<w:lang w:val="${xa(lg)}"/>`;
  return p ? `<w:rPr>${p}</w:rPr>` : "";
}

export function imageSize(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return [dv.getUint32(16), dv.getUint32(20)];
    if (b[0] === 0x47 && b[1] === 0x49) return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (b[0] === 0x42 && b[1] === 0x4D) return [dv.getInt32(18, true), Math.abs(dv.getInt32(22, true))];
    if (b[0] === 0x52 && b[8] === 0x57) {
      const ch = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (ch === "VP8X") return [1 + (b[24] | b[25] << 8 | b[26] << 16), 1 + (b[27] | b[28] << 8 | b[29] << 16)];
      if (ch === "VP8 ") return [dv.getUint16(26, true) & 0x3FFF, dv.getUint16(28, true) & 0x3FFF];
      if (ch === "VP8L") { const v = dv.getUint32(21, true); return [(v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1]; }
    }
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(m)) {
          return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
        }
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch (e) { /* not one we know */ }
  return null;
}

export function extOf(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return ["png", "image/png"];
  if (b[0] === 0x47 && b[1] === 0x49) return ["gif", "image/gif"];
  if (b[0] === 0x42 && b[1] === 0x4D) return ["bmp", "image/bmp"];
  if (b[0] === 0x52 && b[8] === 0x57) return ["webp", "image/webp"];
  return ["jpeg", "image/jpeg"];
}

// lines (wordio's) -> a .docx Blob. pictureBytes(img) -> Promise<Uint8Array|null>
// opts (RossDraft's Compile): size (half-points), line (240ths of a line), indent (first line, twips, for body
// paragraphs without noIndent), justify, header (text before the page number, top right), footer ("page": the
// number, centred at the foot), titlePage (no header or footer on page 1), margins (twips), headingsPlain
// (headings at the body's size, not bold: the manuscript look). Lines may carry: noIndent, sceneBreak, titlePage.
// a table (Compile's ln.table: rows of cells' text), the text's width shared out evenly, thin borders
export function tableXml(rows, width = 9072) {
  const n = Math.max(1, ...rows.map((r) => r.length));
  const cw = Math.floor(width / n);
  const b = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${cw * n}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(b).join("")}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${Array.from({ length: n }, () => `<w:gridCol w:w="${cw}"/>`).join("")}</w:tblGrid>` +
    rows.map((r) => `<w:tr>${Array.from({ length: n }, (_, k) => `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/></w:tcPr>` +
      `<w:p><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>${r[k] ? `<w:r><w:t xml:space="preserve">${x(r[k])}</w:t></w:r>` : ""}</w:p></w:tc>`).join("")}</w:tr>`).join("") +
    "</w:tbl>";
}

// RossDraft 1.8.0: a table line with its cells' formatting (bold, italic, underline, strikethrough,
// highlighting), even columns, thin lines (none when noLines). rowsOrLine: a table line, or Compile's rows of words
export function cellsTableXml(ln, width = 9072) {
  const rows = ln.cells || [];
  const n = Math.max(1, ...rows.map((r) => r.length));
  const cw = Math.floor(width / n);
  // (1.8.1) the widths the page gave them (dragged), scaled to the text's width
  const ws = ln.widths && ln.widths.length === n && !ln.equal ? (() => {
    const sum = ln.widths.reduce((a, b2) => a + b2, 0) || 1;
    return ln.widths.map((x) => Math.max(200, Math.round(x * Math.min(1, width / sum))));
  })() : Array(n).fill(cw);
  const b = (side) => ln.noLines ? `<w:${side} w:val="nil"/>` : `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const runX = (r) => {
    const t = (r.t || "").split(OBJ).join("");
    if (!t) return "";
    const f = r.f || new Set();
    const pr = (f.has("b") ? "<w:b/>" : "") + (f.has("i") ? "<w:i/>" : "") + (f.has("s") ? "<w:strike/>" : "") +
      (f.has("h") ? '<w:highlight w:val="yellow"/>' : "") + (f.has("u") ? '<w:u w:val="single"/>' : "");
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  };
  const para = (p) => `<w:p><w:pPr><w:ind w:firstLine="0"/>${p.align ? `<w:jc w:val="${p.align === "justify" ? "both" : p.align}"/>` : ""}</w:pPr>` +
    (p.runs || []).map(runX).join("") + "</w:p>";
  return `<w:tbl><w:tblPr><w:tblW w:w="${ws.reduce((a, b2) => a + b2, 0)}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(b).join("")}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${ws.map((x2) => `<w:gridCol w:w="${x2}"/>`).join("")}</w:tblGrid>` +
    rows.map((r, ri) => `<w:tr>${Array.from({ length: n }, (_, k) => {
      // (1.13.0) merged cells: one tc for a cell and those merged into it from the right; vMerge down
      const cv = ln.cover || {};
      if (cv[ri + "." + k] === "l") return "";
      let span = 1;
      while (k + span < n && cv[ri + "." + (k + span)] === "l") span++;
      const vm = cv[ri + "." + k] === "u" ? "<w:vMerge/>" : cv[(ri + 1) + "." + k] === "u" ? '<w:vMerge w:val="restart"/>' : "";
      const wsum = ws.slice(k, k + span).reduce((a, b2) => a + b2, 0);
      return `<w:tc><w:tcPr><w:tcW w:w="${wsum}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${vm}</w:tcPr>` +
        ((cv[ri + "." + k] !== "u" && r[k] && r[k].length ? r[k] : [{ runs: [] }]).map(para).join("")) + "</w:tc>";
    }).join("")}</w:tr>`).join("") +
    "</w:tbl>";
}

export async function writeDocx(lines, pictureBytes, title = "", font = "Cambria", opts = {}) {
  const body = [], rels = [], media = [], usedNotes = [];
  const links = new Map();
  let nOrdered = 0, runId = null;
  const orderedIds = lines.map((ln) => {
    if (ln.kind === "ul" || ln.kind === "ol") {
      if (runId == null || (ln.kind === "ol" && ln.restart)) { nOrdered += 1; runId = nOrdered + 1; }
      return runId;
    }
    runId = null;
    return null;
  });
  let picId = 0;
  const rel = (target, type, external) => {
    const rid = "rId" + (rels.length + 10);
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" ` +
      `Target="${xa(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return rid;
  };
  const pictureXml = async (img) => {
    const data = await pictureBytes(img);
    if (!data) return "";
    const size = imageSize(data) || [800, 600];
    const [ext] = extOf(data);
    picId += 1;
    const name = `image${picId}.${ext}`;
    media.push([name, data]);
    const rid = rel("media/" + name, "image");
    const share = { small: 1 / 3, medium: 0.6 }[img && img.size] || 1;
    const cx = Math.min(size[0] * 9525, Math.floor(TEXT_WIDTH_EMU * share));
    const cy = Math.floor(cx * size[1] / Math.max(1, size[0]));
    const n = picId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/>` +
      '</wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
      "</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  };
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k];
    const kind = ln.kind;
    if (ln.cells) { body.push(cellsTableXml(ln, 11906 - 2 * (opts.margins || 1417))); continue; }
    if (ln.table) { body.push(tableXml(ln.table, 11906 - 2 * (opts.margins || 1417))); continue; }
    // the paragraph's settings, in the order Word's schema has them
    let style = "", num = "", spacing = "", ind = "", jc = "";
    if (ln.code) style = '<w:pStyle w:val="Code"/>';
    else if (kind && kind[0] === "h") style = `<w:pStyle w:val="Heading${kind[1]}"/>`;
    else if (kind === "quote") style = '<w:pStyle w:val="Quote"/>';
    else if (kind === "ul" || kind === "ol") {
      style = '<w:pStyle w:val="ListParagraph"/>';
      num = `<w:numPr><w:ilvl w:val="${Math.min(8, Math.max(0, (ln.depth || 1) - 1))}"/>` +
        `<w:numId w:val="${kind === "ul" ? 1 : orderedIds[k]}"/></w:numPr>`;
    }
    const isBody = !kind && !ln.code && !ln.sceneBreak && !ln.titlePage;
    if (ln.titlePage === "title") spacing = '<w:spacing w:before="4320" w:after="240"/>';
    else if (ln.titlePage) spacing = `<w:spacing w:before="${ln.titlePage === "words" ? 480 : 120}"/>`;
    else if (ln.sceneBreak && !opts.headingsPlain) spacing = '<w:spacing w:before="240" w:after="240"/>';
    else if (kind === "h1" && opts.headingsPlain) spacing = '<w:spacing w:before="2880" w:after="480"/>';
    else if (ln.gapBefore && !ln.pageBreak) spacing = '<w:spacing w:before="360"/>';
    if (opts.indent && isBody && !ln.noIndent && !ln.align) ind = `<w:ind w:firstLine="${opts.indent}"/>`;
    const align = ln.align || ((kind === "h1" || kind === "h2") && opts.headingsPlain ? "center" : null) ||
      (opts.justify && isBody ? "justify" : null);
    if (align && !ln.code) jc = `<w:jc w:val="${align === "justify" ? "both" : align}"/>`;
    // (1.9.0) the paragraph's own line spacing
    if (ln.ls && !ln.code) {
      const line = ` w:line="${Math.round(+ln.ls * 240)}" w:lineRule="auto"`;
      spacing = spacing ? spacing.replace("/>", line + "/>") : `<w:spacing${line}/>`;
    }
    const ppr = style + (ln.pageBreak ? "<w:pageBreakBefore/>" : "") + num + spacing + ind + jc;
    let out = "<w:p>" + (ppr ? `<w:pPr>${ppr}</w:pPr>` : "") + (ln.brk ? '<w:r><w:br w:type="page"/></w:r>' : "");
    for (const r of ln.runs || []) {
      if (r.img) { out += await pictureXml(r.img); continue; }
      const t = r.t.split(OBJ).join("");
      if (!t) continue;
      const f = ln.code ? new Set() : r.f || new Set();
      const href = r.href;
      // the title page's title, larger; a plain manuscript heading, the body's size and weight
      const extra = ln.titlePage === "title" ? `<w:sz w:val="${opts.headingsPlain ? 28 : 48}"/><w:szCs w:val="${opts.headingsPlain ? 28 : 48}"/>` :
        kind && kind[0] === "h" && opts.headingsPlain ? `<w:b w:val="0"/><w:sz w:val="${opts.size || 24}"/><w:szCs w:val="${opts.size || 24}"/>` : "";
      if (extra && !href) { const rp = rpr(f, false); out += `<w:r>${rp ? rp.replace("</w:rPr>", extra + "</w:rPr>") : `<w:rPr>${extra}</w:rPr>`}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`; continue; }
      if (t.includes(NOTE_A)) {
        for (const piece of splitNotes(t)) {
          if (piece.note) {
            const k = piece.note[0] === "e" ? "endnote" : "footnote";
            usedNotes.push(piece.note[0] + piece.note[1]);
            out += `<w:r><w:rPr><w:rStyle w:val="${k === "footnote" ? "Footnote" : "Endnote"}Reference"/></w:rPr><w:${k}Reference w:id="${piece.note[1]}"/></w:r>`;
          } else out += `<w:r>${rpr(f, false)}<w:t xml:space="preserve">${x(piece.t)}</w:t></w:r>`;
        }
        continue;
      }
      if (href && !ln.code) {
        let rid = links.get(href);
        if (!rid) { rid = rel(href, "hyperlink", true); links.set(href, rid); }
        out += `<w:hyperlink r:id="${rid}"><w:r>${rpr(f, true)}<w:t xml:space="preserve">${x(t)}</w:t></w:r></w:hyperlink>`;
      } else out += `<w:r>${rpr(f, false)}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    }
    body.push(out + "</w:p>");
  }
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    `xmlns:a="${A_}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body.join("") || "<w:p/>"}<w:sectPr>` +
    (opts.header != null ? `<w:headerReference w:type="default" r:id="rIdHd1"/>` : "") +
    (opts.footer ? `<w:footerReference w:type="default" r:id="rIdFt1"/>` : "") +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    `<w:pgMar w:top="${opts.margins || 1417}" w:right="${opts.margins || 1417}" w:bottom="${opts.margins || 1417}" w:left="${opts.margins || 1417}" w:header="708" w:footer="708" w:gutter="0"/>` +
    (opts.titlePage ? "<w:titlePg/>" : "") +
    "</w:sectPr></w:body></w:document>";
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const hf = (tag, jcv, text) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${tag} xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:jc w:val="${jcv}"/></w:pPr>` +
    (text ? `<w:r><w:t xml:space="preserve">${x(text)}</w:t></w:r>` : "") + pageField + `</w:p></w:${tag}>`;
  // the notes the text has (opts.notes: "f17" -> its words)
  const noteParts = [];
  for (const [kind, k] of [["f", "footnote"], ["e", "endnote"]]) {
    const ids = usedNotes.filter((n) => n[0] === kind).map((n) => n.slice(1));
    if (!ids.length) continue;
    const xmlText = emptyNotesXml(kind).replace(`</w:${k}s>`, ids.map((id) =>
      `<w:${k} w:id="${id}">${noteParasXml(kind, (opts.notes && opts.notes.get(kind + id)) || "")}</w:${k}>`).join("") + `</w:${k}s>`);
    noteParts.push([`word/${k}s.xml`, xmlText, k]);
    rels.push(`<Relationship Id="rId${k === "footnote" ? "Fn" : "En"}1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${k}s" Target="${k}s.xml"/>`);
  }
  if (noteParts.length) {
    rels.push('<Relationship Id="rIdSet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>');
    noteParts.push(["word/settings.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + `<w:settings xmlns:w="${W}">` +
      noteParts.map(([, , k]) => `<w:${k}Pr><w:${k} w:id="-1"/><w:${k} w:id="0"/></w:${k}Pr>`).join("") + "</w:settings>", "settings"]);
  }
  if (opts.header != null) rels.push('<Relationship Id="rIdHd1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
  if (opts.footer) rels.push('<Relationship Id="rIdFt1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    rels.join("") + "</Relationships>";
  const exts = [...new Map(media.map(([, d]) => { const e = extOf(d); return [e[0], e]; })).values()].sort();
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    exts.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    noteParts.map(([n, , k]) => `<Override PartName="/${n}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${k}${k === "settings" ? "" : "s"}+xml"/>`).join("") +
    (opts.header != null ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "") +
    (opts.footer ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "") +
    "</Types>";
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    `xmlns:dc="${DC}" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${x(title)}</dc:title><dc:creator>Ross Note</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  return zip([
    ["[Content_Types].xml", types, true], ["_rels/.rels", rootRels, true], ["docProps/core.xml", core, true],
    ["word/document.xml", document, true], ["word/styles.xml", stylesXml(font, opts), true],
    ...(opts.header != null ? [["word/header1.xml", hf("hdr", "right", opts.header), true]] : []),
    ...noteParts.map(([n, t]) => [n, t, true]),
    ...(opts.footer ? [["word/footer1.xml", hf("ftr", "center", ""), true]] : []),
    ["word/numbering.xml", numberingXml(nOrdered), true], ["word/_rels/document.xml.rels", docRels, true],
    ...media.map(([n, d]) => ["word/media/" + n, d, false]),
  ]);
}

// ================================================================ a note for an email (as the laptop's notesio)
function runText(r) {
  const t = r.t.split(OBJ).join("");
  const h = r.href;
  if (h && t && t !== h && md.hrefOf(t) !== h) return `${t} (${h})`;
  return t;
}

export function plainText(lines) {
  const out = [];
  let counters = new Map();
  for (const ln of lines) {
    const kind = ln.kind;
    const text = ln.runs.filter((r) => !r.img).map(runText).join("");
    const d = ln.depth || 1;
    if (kind === "ol") {
      counters = new Map([...counters].filter(([k]) => k <= d));
      counters.set(d, (counters.get(d) || 0) + 1);
    } else if (kind !== "ul") counters = new Map();
    if (!text.trim() && ln.runs.length && ln.runs.every((r) => r.img)) continue;
    if (kind === "ul") out.push("  ".repeat(d - 1) + "• " + text);
    else if (kind === "ol") out.push("  ".repeat(d - 1) + counters.get(d) + ". " + text);
    else if (kind === "quote") out.push("> " + text);
    else out.push(text);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n") + "\n";
}

export function htmlText(lines) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out = [];
  let counters = new Map();
  for (const ln of lines) {
    const kind = ln.kind;
    let body = "";
    for (const r of ln.runs) {
      if (r.img) continue;
      let t = esc(r.t.split(OBJ).join(""));
      if (!t) continue;
      const f = r.f || new Set();
      if (f.has("b")) t = `<b>${t}</b>`;
      if (f.has("i")) t = `<i>${t}</i>`;
      if (f.has("u")) t = `<u>${t}</u>`;
      if (f.has("s")) t = `<s>${t}</s>`;
      if (f.has("h")) t = `<span style="background-color:#ffd54f">${t}</span>`;
      if (r.href) t = `<a href="${esc(r.href).replace(/"/g, "&quot;")}">${t}</a>`;
      body += t;
    }
    if (!body && ln.runs.length && ln.runs.every((r) => r.img)) continue;
    const d = ln.depth || 1;
    if (kind === "ol") {
      counters = new Map([...counters].filter(([k]) => k <= d));
      counters.set(d, (counters.get(d) || 0) + 1);
    } else if (kind !== "ul") counters = new Map();
    const ta = ln.align && !ln.code ? `text-align:${ln.align};` : "";
    if (ln.code) out.push(`<div style="font-family:monospace">${body || "&nbsp;"}</div>`);
    else if (kind && kind[0] === "h") { const h = Math.min(3, +kind[1]); out.push(`<h${h}${ta ? ` style="${ta}"` : ""}>${body}</h${h}>`); }
    else if (kind === "ul") out.push(`<div style="margin-left:${d}em;${ta}">• ${body}</div>`);
    else if (kind === "ol") out.push(`<div style="margin-left:${d}em;${ta}">${counters.get(d)}. ${body}</div>`);
    else if (kind === "quote") out.push(`<blockquote style="margin:0 0 0 2em;color:#555;${ta}">${body}</blockquote>`);
    else out.push(`<p style="margin:0;${ta}">${body || "<br>"}</p>`);
  }
  return `<html><body>${out.join("\n")}</body></html>`;
}
