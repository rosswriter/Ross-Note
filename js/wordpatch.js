// Writing a Word file back into itself (a Ross Writer scene edited on the tablet).
//
// The scene's own package is kept: its styles, fonts, page setup, headers and everything else Ross
// Writer or Word put in it. Only the body is written again, and in the body every paragraph that's the
// same as it was (the same words, the same bold, italic... ) is the very paragraph it was, untouched:
// its indent, its alignment, its font, its bookmarks. A paragraph you changed keeps its paragraph's
// settings (indent, alignment, style) and the look of its first words (font, size, colour); a new
// paragraph takes the scene's usual look. So Ross Writer gets back the file it gave, with your words in it.
//
// Scenes with things this can't keep (comments, footnotes, tracked changes, tables...) aren't written
// at all: blockers() says which, and the tablet shows them read-only.
import { unzip, zip, imageSize, extOf } from "./wordio.js?v=1.7.1";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_ = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const OBJ = "￼";
const TEXT_WIDTH_EMU = 5760720;

// ------------------------------------------------------------------ what the tablet can't keep
const BLOCKERS = [
  [/<w:commentReference\b|<w:commentRangeStart\b/, "comments"],
  [/<w:footnoteReference\b|<w:endnoteReference\b/, "footnotes"],
  [/<w:(ins|del|moveFrom|moveTo)\b|<w:(rPr|pPr|sectPr|tblPr|tcPr|trPr)Change\b/, "tracked changes"],
  [/<w:tbl\b/, "a table"],
  [/<w:txbxContent\b|<mc:AlternateContent\b|<w:object\b/, "a text box or shape"],
  [/<m:oMath/, "an equation"],
  [/<w:sdt\b/, "a content control"],
  [/<w:fldChar\b|<w:fldSimple\b|<w:instrText\b/, "a field"],
  [/<w:vanish\b(?![^>]*w:val="(0|false)")/, "hidden text"],
  [/<w:altChunk\b/, "embedded content"],
];

export function blockers(docText) {
  const out = [];
  for (const [re, what] of BLOCKERS) if (re.test(docText)) out.push(what);
  return out;
}

// ------------------------------------------------------------------ comparing lines
const FLAGS = "bisuh";
function sigOf(ln) {
  const runs = [];
  for (const r of ln.runs || []) {
    if (r.img) {
      runs.push(["", "", "", picName(r.img)]);
      continue;
    }
    const t = (r.t || "").split(OBJ).join("");
    if (!t) continue;
    const f = [...FLAGS].filter((k) => r.f && r.f.has(k)).join("");
    const h = r.href || "";
    const last = runs[runs.length - 1];
    if (last && !last[3] && last[1] === f && last[2] === h) last[0] += t;
    else runs.push([t, f, h, ""]);
  }
  const k = ln.kind || "";
  return JSON.stringify([k, k === "ul" || k === "ol" ? ln.depth || 1 : 0, ln.code ? 1 : 0, runs]);
}

// a picture's file name, wherever it's written from (wordio's name, or a note's picture)
export function picName(img) {
  if (typeof img === "string") return img;
  const s = (img.target && img.target.join ? img.target.join("/") : img.src || "") || "";
  let name = s.split("/").pop() || "";
  try { name = decodeURIComponent(name.replace(/^<|>$/g, "")); } catch (e) { /* as it is */ }
  return name;
}


// which new line is which old one: matched[j] = i, or -1 (common start and end, then the longest
// common run between; very big changes are paired in order instead)
function align(A, B) {
  const n = A.length, m = B.length;
  const matched = new Array(m).fill(-1), paired = new Array(m).fill(-1);
  let s = 0;
  while (s < n && s < m && A[s] === B[s]) { matched[s] = s; s++; }
  let e = 0;
  while (e < n - s && e < m - s && A[n - 1 - e] === B[m - 1 - e]) { matched[m - 1 - e] = n - 1 - e; e++; }
  const a0 = s, a1 = n - e, b0 = s, b1 = m - e;
  const na = a1 - a0, nb = b1 - b0;
  const pairs = [];   // [i, j] matched in the middle
  if (na && nb && na * nb <= 4e6) {
    const L = new Int32Array((na + 1) * (nb + 1));
    const at = (i, j) => i * (nb + 1) + j;
    for (let i = na - 1; i >= 0; i--) {
      for (let j = nb - 1; j >= 0; j--) {
        L[at(i, j)] = A[a0 + i] === B[b0 + j] ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)]);
      }
    }
    let i = 0, j = 0;
    while (i < na && j < nb) {
      if (A[a0 + i] === B[b0 + j]) { pairs.push([a0 + i, b0 + j]); i++; j++; }
      else if (L[at(i + 1, j)] >= L[at(i, j + 1)]) i++;
      else j++;
    }
  }
  for (const [i, j] of pairs) matched[j] = i;
  // the gaps between: a changed line takes the place (and the look) of the old one there
  let pi = a0, pj = b0;
  const gap = (ia, ib, ja, jb) => { for (let k = 0; k < Math.min(ib - ia, jb - ja); k++) paired[ja + k] = ia + k; };
  for (const [i, j] of pairs) { gap(pi, i, pj, j); pi = i + 1; pj = j + 1; }
  gap(pi, a1, pj, b1);
  return { matched, paired };
}

// ------------------------------------------------------------------ XML helpers
const parse = (t) => new DOMParser().parseFromString(t, "application/xml");
const ser = (d) => new XMLSerializer().serializeToString(d);
const wkids = (el, local) => [...el.children].filter((c) => c.namespaceURI === W && (!local || c.localName === local));
const wkid = (el, local) => (el ? wkids(el, local)[0] || null : null);
const wval = (el, name = "val") => (el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) : null);

// CT_RPr's order (Word wants it)
const RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline",
  "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
  "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
  "lang", "eastAsianLayout", "specVanish", "oMath"];
const OURS = new Set(["rStyle", "b", "bCs", "i", "iCs", "strike", "dstrike", "highlight", "u", "shd", "vanish",
  "specVanish", "webHidden", "rPrChange"]);

function sortRpr(rpr) {
  const rank = (c) => {
    if (c.namespaceURI !== W) return 1000;
    const k = RPR_ORDER.indexOf(c.localName);
    return k < 0 ? 999 : k;
  };
  const kids = [...rpr.children].map((c, k) => [rank(c), k, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , c] of kids) rpr.appendChild(c);
}

// CT_PPr's order, for what we put in
const PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
  "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
  "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
  "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
  "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
function sortPpr(ppr) {
  const rank = (c) => {
    if (c.namespaceURI !== W) return 1000;
    const k = PPR_ORDER.indexOf(c.localName);
    return k < 0 ? 999 : k;
  };
  const kids = [...ppr.children].map((c, k) => [rank(c), k, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , c] of kids) ppr.appendChild(c);
}

// ------------------------------------------------------------------ the package
async function loadAll(files) {
  const out = new Map();
  for (const [name, get] of files) out.set(name, await get());
  return out;
}
const dec = (b) => (typeof b === "string" ? b : new TextDecoder().decode(b));

function relsPathFor(part) {   // word/document.xml -> word/_rels/document.xml.rels
  const k = part.lastIndexOf("/");
  return part.slice(0, k + 1) + "_rels/" + part.slice(k + 1) + ".rels";
}

function resolveTarget(base, target) {   // a relationship's target, as a part name
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

// ------------------------------------------------------------------ the writing
// files: wordio.unzip()'s map of the scene; old: readDocx(.., {keep}) lines of it (each with .src);
// oldSigs: their signatures as the note shows them (or null: from old); lines: wordio lines to write;
// pictureBytes(img) -> Uint8Array|null for pictures that aren't in the scene already.
export async function patchDocx(files, old, oldSigs, lines, pictureBytes) {
  const all = await loadAll(files);
  const mainPart = (() => {
    const rels = all.get("_rels/.rels");
    if (rels) {
      for (const r of parse(dec(rels)).getElementsByTagNameNS(PR, "Relationship")) {
        if ((r.getAttribute("Type") || "").endsWith("/officeDocument")) return resolveTarget("", r.getAttribute("Target"));
      }
    }
    return "word/document.xml";
  })();
  const doc = parse(dec(all.get(mainPart)));
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const kids = [...body.children];
  const sectPr = kids.length && kids[kids.length - 1].namespaceURI === W && kids[kids.length - 1].localName === "sectPr"
    ? kids[kids.length - 1] : null;
  const relsName = relsPathFor(mainPart);
  const relsDoc = all.has(relsName) ? parse(dec(all.get(relsName)))
    : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"/>`);
  const relsRoot = relsDoc.documentElement;
  const relEls = () => [...relsRoot.getElementsByTagNameNS(PR, "Relationship")];
  const ctDoc = parse(dec(all.get("[Content_Types].xml")));
  const ctRoot = ctDoc.documentElement;
  const partDir = mainPart.slice(0, mainPart.lastIndexOf("/") + 1);   // "word/"

  // --- styles: the ones the scene has, by name; ours added where it has none
  const stylesName = (() => {
    for (const r of relEls()) if ((r.getAttribute("Type") || "").endsWith("/styles")) return resolveTarget(mainPart, r.getAttribute("Target"));
    return null;
  })();
  const stylesDoc = stylesName && all.has(stylesName) ? parse(dec(all.get(stylesName))) : null;
  let stylesChanged = false;
  const styleIdByName = new Map(), styleIds = new Set();
  if (stylesDoc) {
    for (const st of stylesDoc.getElementsByTagNameNS(W, "style")) {
      const id = wval(st, "styleId");
      styleIds.add(id);
      const nm = (wval(wkid(st, "name")) || "").toLowerCase();
      if (nm && !styleIdByName.has(nm)) styleIdByName.set(nm, id);
    }
  }
  const OUR_STYLES = {
    Quote: '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:ind w:left="567" w:right="284"/></w:pPr></w:style>',
    ListParagraph: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
      '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>',
    Code: '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
      '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>',
    Hyperlink: '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
      '<w:rPr><w:color w:val="1A5FB4"/><w:u w:val="single"/></w:rPr></w:style>',
  };
  for (let k = 1; k <= 6; k++) {
    OUR_STYLES["Heading" + k] = `<w:style w:type="paragraph" w:styleId="Heading${k}"><w:name w:val="heading ${k}"/>` +
      '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>' +
      `<w:spacing w:before="${k < 3 ? 240 : 160}" w:after="80"/><w:outlineLvl w:val="${k - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24, 24, 24][k - 1]}"/></w:rPr></w:style>`;
  }
  const styleFor = (names, ours) => {
    for (const n of names) if (styleIdByName.has(n)) return styleIdByName.get(n);
    if (!stylesDoc) return ours;
    if (!styleIds.has(ours)) {
      const el = parse(`<w:x xmlns:w="${W}">${OUR_STYLES[ours]}</w:x>`).documentElement.firstElementChild;
      stylesDoc.documentElement.appendChild(stylesDoc.importNode(el, true));
      styleIds.add(ours);
      styleIdByName.set(names[0], ours);
      stylesChanged = true;
    }
    return ours;
  };

  // --- numbering, for new lists that have none to follow
  let numDoc = null, numName = null, numChanged = false;
  for (const r of relEls()) {
    if ((r.getAttribute("Type") || "").endsWith("/numbering")) numName = resolveTarget(mainPart, r.getAttribute("Target"));
  }
  if (numName && all.has(numName)) numDoc = parse(dec(all.get(numName)));
  const newNum = (bullet) => {
    if (!numDoc) {
      numName = partDir + "numbering.xml";
      numDoc = parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"/>`);
      addRel("numbering", "numbering.xml");
      addOverride("/" + numName, "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml");
    }
    const root = numDoc.documentElement;
    const ids = (tag, attr) => [...root.getElementsByTagNameNS(W, tag)].map((e) => +wval(e, attr) || 0);
    const aid = Math.max(0, ...ids("abstractNum", "abstractNumId")) + 1;
    const nid = Math.max(0, ...ids("num", "numId")) + 1;
    let lv = "";
    for (let k = 0; k < 9; k++) {
      const ind = 720 * (k + 1);
      lv += bullet
        ? `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${"•◦▪"[k % 3]}"/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${k + 1}."/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
    const frag = parse(`<w:x xmlns:w="${W}"><w:abstractNum w:abstractNumId="${aid}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      `${lv}</w:abstractNum><w:num w:numId="${nid}"><w:abstractNumId w:val="${aid}"/></w:num></w:x>`).documentElement;
    const [abs, num] = [...frag.children].map((c) => numDoc.importNode(c, true));
    const firstNum = wkid(root, "num");
    root.insertBefore(abs, firstNum || wkid(root, "numIdMacAtCleanup"));
    root.insertBefore(num, wkid(root, "numIdMacAtCleanup"));
    numChanged = true;
    return String(nid);
  };

  // --- relationships and content types
  let relN = 0;
  const takenIds = () => new Set(relEls().map((r) => r.getAttribute("Id")));
  function addRel(type, target, external) {
    const taken = takenIds();
    let id;
    do { relN += 1; id = "rIdRN" + relN; } while (taken.has(id));
    const el = relsDoc.createElementNS(PR, "Relationship");
    el.setAttribute("Id", id);
    el.setAttribute("Type", REL + type);
    el.setAttribute("Target", target);
    if (external) el.setAttribute("TargetMode", "External");
    relsRoot.appendChild(el);
    return id;
  }
  function addOverride(part, type) {
    for (const o of ctRoot.getElementsByTagNameNS(CT, "Override")) if (o.getAttribute("PartName") === part) return;
    const el = ctDoc.createElementNS(CT, "Override");
    el.setAttribute("PartName", part);
    el.setAttribute("ContentType", type);
    ctRoot.appendChild(el);
  }
  function addDefault(ext, type) {
    for (const d of ctRoot.getElementsByTagNameNS(CT, "Default")) if ((d.getAttribute("Extension") || "").toLowerCase() === ext) return;
    const el = ctDoc.createElementNS(CT, "Default");
    el.setAttribute("Extension", ext);
    el.setAttribute("ContentType", type);
    ctRoot.insertBefore(el, ctRoot.firstElementChild);
  }
  const linkIds = new Map();
  const linkRel = (href) => {
    if (!linkIds.has(href)) linkIds.set(href, addRel("hyperlink", href, true));
    return linkIds.get(href);
  };
  // pictures: the scene's own (by name) keep their relationship; others are added
  const picRels = new Map();
  for (const r of relEls()) {
    if ((r.getAttribute("Type") || "").endsWith("/image") && r.getAttribute("TargetMode") !== "External") {
      const name = resolveTarget(mainPart, r.getAttribute("Target")).split("/").pop();
      if (!picRels.has(name)) picRels.set(name, r.getAttribute("Id"));
    }
  }
  let docPrId = 0;
  for (const e of doc.getElementsByTagNameNS(WP, "docPr")) docPrId = Math.max(docPrId, +e.getAttribute("id") || 0);
  for (const e of doc.getElementsByTagNameNS(PIC, "cNvPr")) docPrId = Math.max(docPrId, +e.getAttribute("id") || 0);
  let mediaN = 0;
  const pictureXml = async (img) => {
    const name = picName(img);
    let rid = picRels.get(name), data = null;
    if (rid) {
      const r = relEls().find((x) => x.getAttribute("Id") === rid);
      data = all.get(resolveTarget(mainPart, r.getAttribute("Target"))) || null;
    }
    if (!data) {
      data = await pictureBytes(img);
      if (!data) return "";
      const [ext, type] = extOf(data);
      let part;
      do { mediaN += 1; part = `${partDir}media/rn-image${mediaN}.${ext}`; } while (all.has(part));
      all.set(part, data);
      addDefault(ext, type);
      rid = addRel("image", part.slice(partDir.length));
      picRels.set(name, rid);
    }
    const size = imageSize(data) || [800, 600];
    const share = { small: 1 / 3, medium: 0.6 }[img && img.size] || 1;
    const cx = Math.min(size[0] * 9525, Math.floor(TEXT_WIDTH_EMU * share));
    const cy = Math.floor(cx * size[1] / Math.max(1, size[0]));
    docPrId += 1;
    const n = docPrId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/>` +
      '</wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${xa(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
      "</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  };

  // --- the scene's usual look: the commonest plain paragraph settings and the commonest run look
  const srcEl = (i) => kids[old[i].src];
  const firstTextRpr = (p) => {
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      if (r.getElementsByTagNameNS(W, "t").length) return wkid(r, "rPr");
    }
    return null;
  };
  const markRpr = (p) => wkid(wkid(p, "pPr"), "rPr");
  const plainOld = old.map((ln, i) => (ln.src != null && !ln.kind && !ln.code ? i : -1)).filter((i) => i >= 0);
  const common = (vals) => {
    const n = new Map();
    let best = null, bn = 0;
    for (const v of vals) {
      const k = v ? ser(v) : "";
      const c = (n.get(k) || 0) + 1;
      n.set(k, c);
      if (c > bn) { bn = c; best = v; }
    }
    return best;
  };
  const plainP = plainOld.map(srcEl).filter((p) => p && p.localName === "p");
  const textP = plainP.filter((p) => (p.textContent || "").trim());
  const usualPpr = common((textP.length ? textP : plainP).map((p) => {
    const ppr = wkid(p, "pPr");
    if (!ppr) return null;
    const c = ppr.cloneNode(true);
    for (const x of wkids(c)) if (["sectPr", "pPrChange", "numPr"].includes(x.localName)) c.removeChild(x);
    return c;
  }));
  const usualRpr = common(textP.map(firstTextRpr).filter(Boolean)) || common(plainP.map(markRpr).filter(Boolean));
  // the first old paragraph of a kind (a heading of that level, a quote, a list...): its settings for new ones
  const firstOfKind = new Map();
  old.forEach((ln, i) => {
    if (ln.src == null || ln.code) return;
    const k = ln.kind ? ln.kind + (ln.kind === "ul" || ln.kind === "ol" ? ":" + (ln.depth || 1) : "") : "p";
    if (!firstOfKind.has(k)) firstOfKind.set(k, srcEl(i));
    if ((ln.kind === "ul" || ln.kind === "ol") && !firstOfKind.has(ln.kind)) firstOfKind.set(ln.kind, srcEl(i));
  });

  const baseRpr = (from) => {
    // (an old paragraph with no look of its own keeps none: its style gives it)
    let r = from ? firstTextRpr(from) || markRpr(from) : usualRpr;
    if (!r) return null;
    const c = r.cloneNode(true);
    for (const x of [...c.children]) if (x.namespaceURI === W && OURS.has(x.localName)) c.removeChild(x);
    // the paragraph mark's own (pPr/rPr) can carry ins/del: not for runs
    for (const x of [...c.children]) if (x.namespaceURI === W && ["ins", "del", "moveFrom", "moveTo"].includes(x.localName)) c.removeChild(x);
    return c;
  };

  // ordered lists: each run of them its own numbering (as wordio writes)
  const numFor = new Map();   // line index -> numId for new lists with nothing to follow

  const cleanPpr = (el, keepSect) => {
    const o = el && wkid(el, "pPr");
    if (!o) return null;
    const c = o.cloneNode(true);
    for (const x of wkids(c)) if (x.localName === "pPrChange" || (x.localName === "sectPr" && !keepSect)) c.removeChild(x);
    return c;
  };
  const kindKey = (ln) => (ln.code ? "code" : ln.kind || "p");

  const buildP = async (ln, j, tmpl, oneToOne) => {
    const kind = ln.code ? null : ln.kind || null;
    const p = doc.createElementNS(W, "w:p");
    const same = !!(tmpl && tmpl.el && tmpl.key === kindKey(ln));
    // the paragraph settings: the old paragraph's here if it was the same kind; else one like it in the
    // scene; else the scene's usual (plain text) or the style for it
    let ppr = null, likeEl = null;
    if (same) ppr = cleanPpr(tmpl.el, oneToOne);
    else if (ln.code) ppr = null;
    else if (!kind) ppr = usualPpr ? usualPpr.cloneNode(true) : null;
    else {
      likeEl = firstOfKind.get(kind === "ul" || kind === "ol" ? kind + ":" + (ln.depth || 1) : kind) ||
        (kind === "ul" || kind === "ol" ? firstOfKind.get(kind) : null);
      ppr = cleanPpr(likeEl, false);
    }
    const ensurePpr = () => { if (!ppr) ppr = doc.createElementNS(W, "w:pPr"); return ppr; };
    const setStyle = (id) => {
      const pp = ensurePpr();
      let ps = wkid(pp, "pStyle");
      if (!ps) { ps = doc.createElementNS(W, "w:pStyle"); pp.insertBefore(ps, pp.firstChild); }
      ps.setAttributeNS(W, "w:val", id);
    };
    const dropNum = () => { if (ppr) for (const x of wkids(ppr, "numPr")) ppr.removeChild(x); };
    if (ln.code) {
      setStyle(styleFor(["code", "html preformatted", "preformatted text", "source code"], "Code"));
    } else if (kind && kind[0] === "h") {
      if (!ppr || !wkid(ppr, "pStyle")) setStyle(styleFor(["heading " + kind[1]], "Heading" + kind[1]));
      dropNum();
    } else if (kind === "quote") {
      if (!ppr || !wkid(ppr, "pStyle")) setStyle(styleFor(["quote", "intense quote", "block text", "quotations"], "Quote"));
      dropNum();
    } else if (kind === "ul" || kind === "ol") {
      const lvl = Math.min(8, Math.max(0, (ln.depth || 1) - 1));
      let np = ppr && wkid(ppr, "numPr");
      if (!np && !(ppr && wkid(ppr, "pStyle"))) {
        setStyle(styleFor(["list paragraph"], "ListParagraph"));
        if (!numFor.has(j)) {
          const id = newNum(kind === "ul");
          for (let t = j; t < lines.length && lines[t].kind === kind && !lines[t].code; t++) numFor.set(t, id);
        }
        np = doc.createElementNS(W, "w:numPr");
        const ni = doc.createElementNS(W, "w:numId");
        ni.setAttributeNS(W, "w:val", numFor.get(j));
        np.append(doc.createElementNS(W, "w:ilvl"), ni);
        ensurePpr().appendChild(np);
      }
      if (np) {
        let il = wkid(np, "ilvl");
        if (!il) { il = doc.createElementNS(W, "w:ilvl"); np.insertBefore(il, np.firstChild); }
        il.setAttributeNS(W, "w:val", String(lvl));
      }
    } else dropNum();
    if (ppr) { sortPpr(ppr); if (ppr.children.length) p.appendChild(ppr); }
    // the look of the words: the old paragraph's, or one like it; headings and the like without one
    // take their style's own (no run look), plain text the scene's usual
    const base = same ? baseRpr(tmpl.el) : likeEl ? baseRpr(likeEl) : !kind && !ln.code ? baseRpr(null) : null;
    let xml = "";
    for (const r of ln.runs || []) {
      if (r.img) { xml += await pictureXml(r.img); continue; }
      const t = (r.t || "").split(OBJ).join("");
      if (!t) continue;
      const f = ln.code ? new Set() : r.f || new Set();
      const rp = base ? base.cloneNode(true) : doc.createElementNS(W, "w:rPr");
      const add = (tag, val) => {
        const e = doc.createElementNS(W, "w:" + tag);
        if (val) e.setAttributeNS(W, "w:val", val);
        rp.appendChild(e);
      };
      if (r.href && !ln.code) add("rStyle", styleFor(["hyperlink"], "Hyperlink"));
      if (f.has("b")) { add("b"); add("bCs"); }
      if (f.has("i")) { add("i"); add("iCs"); }
      if (f.has("s")) add("strike");
      if (f.has("h")) add("highlight", "yellow");
      if (f.has("u") && !r.href) add("u", "single");
      sortRpr(rp);
      const rx = (rp.children.length ? ser(rp) : "") + `<w:t xml:space="preserve">${xt(t)}</w:t>`;
      if (r.href && !ln.code) xml += `<w:hyperlink r:id="${linkRel(r.href)}"><w:r>${rx}</w:r></w:hyperlink>`;
      else xml += `<w:r>${rx}</w:r>`;
    }
    if (xml) {
      const frag = parse(`<w:x xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A_}" xmlns:pic="${PIC}">${xml}</w:x>`);
      for (const c of [...frag.documentElement.children]) p.appendChild(doc.importNode(c, true));
    }
    return p;
  };

  // --- the body, line by line
  const A = oldSigs && oldSigs.length === old.length ? oldSigs : old.map(sigOf);
  const B = lines.map(sigOf);
  const { matched, paired } = align(A, B);
  // the old lines of each paragraph
  const groupOf = new Map();
  old.forEach((ln, i) => {
    if (ln.src == null) return;
    if (!groupOf.has(ln.src)) groupOf.set(ln.src, []);
    groupOf.get(ln.src).push(i);
  });
  const used = new Set();
  const outEls = [];
  for (let j = 0; j < lines.length;) {
    const i = matched[j];
    if (i >= 0 && old[i].src != null) {
      const g = groupOf.get(old[i].src);
      if (g[0] === i && !used.has(old[i].src) && g.every((ii, t) => matched[j + t] === ii)) {
        used.add(old[i].src);
        outEls.push(srcEl(i));
        j += g.length;
        continue;
      }
    }
    const pi = i >= 0 ? i : paired[j];
    const tmpl = pi >= 0 && old[pi].src != null ? { el: srcEl(pi), key: kindKey(old[pi]) } : null;
    const oneToOne = !!tmpl && !used.has(old[pi].src) && (groupOf.get(old[pi].src) || []).length === 1;
    if (oneToOne) used.add(old[pi].src);
    outEls.push(await buildP(lines[j], j, tmpl, oneToOne));
    j++;
  }
  for (const c of [...body.children]) body.removeChild(c);
  if (!outEls.length) {
    const p = doc.createElementNS(W, "w:p");
    if (usualPpr) p.appendChild(usualPpr.cloneNode(true));
    outEls.push(p);
  }
  for (const el of outEls) body.appendChild(el);
  if (sectPr) body.appendChild(sectPr);

  // --- relationships nothing uses any more (pictures and links of paragraphs that went)
  const docXml = ser(doc);
  const usedIds = new Set();
  for (const m of docXml.matchAll(/\br:(?:id|embed|link|pict|href)="([^"]+)"/g)) usedIds.add(m[1]);
  for (const m of docXml.matchAll(/\b(?:id|embed|link)="(rId[^"]*)"/g)) usedIds.add(m[1]);
  const dropped = [];
  for (const r of relEls()) {
    const type = r.getAttribute("Type") || "";
    if ((type.endsWith("/image") || type.endsWith("/hyperlink")) && !usedIds.has(r.getAttribute("Id"))) {
      if (type.endsWith("/image") && r.getAttribute("TargetMode") !== "External") dropped.push(resolveTarget(mainPart, r.getAttribute("Target")));
      relsRoot.removeChild(r);
    }
  }
  // a picture file goes only if nothing else in the package points at it
  if (dropped.length) {
    const still = new Set();
    for (const [name, data] of all) {
      if (!name.endsWith(".rels")) continue;
      const owner = name.replace(/_rels\/([^/]+)\.rels$/, "$1");
      const rd = name === relsName ? relsDoc : parse(dec(data));
      for (const r of rd.getElementsByTagNameNS(PR, "Relationship")) {
        if (r.getAttribute("TargetMode") !== "External") still.add(resolveTarget(owner, r.getAttribute("Target") || ""));
      }
    }
    for (const part of dropped) if (!still.has(part)) all.delete(part);
  }

  // --- the package again
  all.set(mainPart, docXml);
  all.set(relsName, ser(relsDoc));
  all.set("[Content_Types].xml", ser(ctDoc));
  if (stylesChanged) all.set(stylesName, ser(stylesDoc));
  if (numChanged) all.set(numName, ser(numDoc));
  const order = ["[Content_Types].xml", ...[...all.keys()].filter((k) => k !== "[Content_Types].xml")];
  return zip(order.map((name) => {
    const data = all.get(name);
    const media = /\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf)$/i.test(name);
    return [name, typeof data === "string" ? withDecl(data) : data, !media];
  }));
}

const xt = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xa = (s) => xt(s).replace(/"/g, "&quot;");
const withDecl = (s) => (s.startsWith("<?xml") ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);

export { unzip, sigOf };
