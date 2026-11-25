// RossDraft 1.3: Scrivener projects, opened and saved in place, as Ross Writer's scriv.py does it.
//
// A Scrivener project is a folder (.scriv) with an index (.scrivx, XML: the Binder tree) and each entry's text as
// RTF: Files/Docs/<ID>.rtf in Scrivener 1 and Scrivener for Linux, Files/Data/<UUID>/content.rtf in Scrivener 3
// (notes: <ID>_notes.rtf / notes.rtf; synopsis: <ID>_synopsis.txt / synopsis.txt). RossDraft reads the RTF itself
// (rtf.js) and, on saving, writes back only what changed: the RTF of each entry you edited, its notes or synopsis,
// and the index when the tree changed (with Scrivener's own copy, binder.autosave, and its checksums of the files
// changed taken out, so Scrivener reads them afresh). Every other file is left exactly as it was. The first save
// in a session keeps a zip of the whole project in RossDraft's storage (the last 10). Entries with Scrivener's own
// inline footnotes, linked footnotes, tables or pictures are read-only (as in Ross Writer), research files too.
// RossDraft 1.7.0: Scrivener's comments can be read, added, changed and deleted, and stay where they are as you
// edit: Scrivener 3's linked comments (the words carry a scrivcmt:// link; the comment's words are in
// content.comments beside content.rtf), Scrivener 1 and 2's (RTF annotations, \chatn) and inline notes
// ({\Scrv_annot …}, in the text itself). Each is kept on its words: on saving, its words are found again in the
// text as it now is (the nearest place they occur), so Scrivener finds them where it left them.
// RossDraft's own settings for it (targets, status, Compile) are kept in Settings/rossdraft.json.

import { ProjectStore, PNote, FLAG_COLOURS } from "./project.js?v=1.9.22-d1.10.2";
import * as md from "./md.js?v=1.9.22-d1.10.2";
import * as wordio from "./wordio.js?v=1.9.22-d1.10.2";
import * as rtf from "./rtf.js?v=1.9.22-d1.10.2";

const SPECIAL = new Set(["DraftFolder", "ResearchFolder", "TrashFolder"]);
const UNSAFE = ["Scrv_fn"];
// RossDraft 1.7.0: an inline note, {\Scrv_annot \color={…} \text=…\end_Scrv_annot}, and the mark it's read as
const INLINE = /\{\\Scrv_annot\s*(\\color=\{[^{}]*\})?\s*\\text=([\s\S]*?)\\end_Scrv_annot\s*\}/g;
const MARK = "\uE010";
const RED = "\\color={\\R=1.0\\G=0.0\\B=0.0}";
// Scrivener 3's named styles, kept as text in its RTF: <$Scr_Ps::0>…<!$Scr_Ps::0>
const STYLE_TAG = /<!?\$Scr_[A-Za-z]+::\d+>/g;
const BACKUPS = 10;
const backedUp = new Set();

const enc = new TextEncoder();
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };
function now() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}
const newUuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); })).toUpperCase();

// ------------------------------------------------------------------ files in the folder
async function dirAt(root, parts, create = false) {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function fileAt(root, path) {
  const parts = path.split("/");
  try { return await (await (await dirAt(root, parts.slice(0, -1))).getFileHandle(parts[parts.length - 1])).getFile(); } catch (e) { return null; }
}
async function writeAt(root, path, data) {
  const parts = path.split("/");
  const d = await dirAt(root, parts.slice(0, -1), true);
  const h = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await h.createWritable();
  await w.write(data);
  await w.close();
}
async function sha1hex(u8) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", u8));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ labels and flags
function rgbOf(s) {
  const v = String(s || "").trim().split(/\s+/).slice(0, 3).map(Number);
  return v.length === 3 && v.every((x) => !isNaN(x)) ? v : null;
}
function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = -1;
  if (d) h = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0 && d) h += 360;
  return [h, mx ? d / mx * 255 : 0];
}
// the RossDraft flag nearest a label's colour (as Ross Writer's nearest_flag)
export function nearestFlag(rgb) {
  if (!rgb) return "";
  const [h1, s1] = hsv(rgb);
  let best = "", bd = null;
  for (const [key, hex] of Object.entries(FLAG_COLOURS)) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [h2, s2] = hsv(c);
    const dh = h1 >= 0 && h2 >= 0 ? Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) : 180;
    const dist = dh * 2 + Math.abs(s1 - s2) / 4;
    if (bd == null || dist < bd) { best = key; bd = dist; }
  }
  return best;
}

// ------------------------------------------------------------------ the store

// ------------------------------------------------------------ RossDraft 1.7.0: comments kept in place
const plainOf = (ln) => (ln.runs || []).map((r) => (r.img ? "" : r.t || "")).join("");
const xmlEsc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function rtfText(t) {
  return "{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\fnil Helvetica;}}\n\\pard\\plain\\f0\\fs24 " +
    String(t).split("\n").map(rtf.esc).join("\\par\n") + "}";
}
function wordsOfRtf(s) {
  try { return rtf.readRtf(bytesOf(s)).lines.map(plainOf).join("\n").trim(); } catch (e) { return ""; }
}
// Word's DTTM (the date in \atndate)
function dttmOf(iso) {
  const d = new Date(iso || Date.now());
  if (isNaN(d)) return null;
  return ((d.getUTCMinutes()) | (d.getUTCHours() << 6) | (d.getUTCDate() << 11) | ((d.getUTCMonth() + 1) << 16) |
    ((d.getUTCFullYear() - 1900) << 20) | (d.getUTCDay() << 29)) >>> 0;
}
// where the words are now: the place they occur nearest where they were; else the word nearest there
function placeAnchor(a, plain) {
  const w = a.words || "";
  if (w) {
    let best = -1;
    for (let k = plain.indexOf(w); k >= 0; k = plain.indexOf(w, k + 1)) {
      if (best < 0 || Math.abs(k - a.start) < Math.abs(best - a.start)) best = k;
    }
    if (best >= 0) return [best, best + w.length];
  }
  let at = Math.max(0, Math.min(plain.length, a.start));
  if (a.point && !w) return [at, at];
  // the word at (or just before) that place
  const isW = (c) => /[\p{L}\p{N}'’-]/u.test(c || "");
  let b = at;
  while (b > 0 && !isW(plain[b - 1]) && !isW(plain[b])) b--;
  let s0 = b, e0 = b;
  while (s0 > 0 && isW(plain[s0 - 1])) s0--;
  while (e0 < plain.length && isW(plain[e0])) e0++;
  return e0 > s0 ? [s0, e0] : [at, at];
}
// the raw RTF put into the lines at plain-text places: [{ off, raw, order }], order: ends, marks, then starts
function putRaw(wl, inserts) {
  inserts.sort((x, y) => x.off - y.off || x.order - y.order);
  let base = 0, k = 0;
  for (const ln of wl) {
    const len = plainOf(ln).length;
    const here = [];
    while (k < inserts.length && inserts[k].off <= base + len) here.push(inserts[k++]);
    if (here.length) {
      const out = [];
      let pos = 0, h = 0;
      for (const r of ln.runs || []) {
        if (r.img || r.raw != null) { out.push(r); continue; }
        const t = r.t || "";
        let from = 0;
        while (h < here.length && here[h].off - base <= pos + t.length) {
          const cut = here[h].off - base - pos;
          if (cut > from) out.push({ ...r, t: t.slice(from, cut) });
          from = Math.max(from, cut);
          out.push({ raw: here[h].raw });
          h++;
        }
        if (from < t.length) out.push({ ...r, t: t.slice(from) });
        pos += t.length;
      }
      while (h < here.length) out.push({ raw: here[h++].raw });
      ln.runs = out;
    }
    base += len + 1;
  }
  while (k < inserts.length) { if (wl.length) (wl[wl.length - 1].runs = wl[wl.length - 1].runs || []).push({ raw: inserts[k].raw }); k++; }
}

// the comments, as the list beside the page shows them
function commentList(anchors) {
  return anchors.map((a, k) => ({ id: String(k + 1), author: a.author || (a.kind === "inline" ? "Inline note" : "Comment"),
    initials: a.initials || "", date: a.date || "", text: a.text || "", words: a.words || "", parent: null, done: false, scriv: a.kind }));
}

export class ScrivStore extends ProjectStore {
  constructor(dirHandle, fileName) {
    super(dirHandle, fileName);
    this.isScriv = true;
    this.info = new WeakMap();      // raw -> { el, uid, sid, type, other, flag0, title0, include0, notes0, synopsis0 }
    this.readOnlyAll = null;        // ["open in Scrivener"] when opened read-only
    this.changed = new Set();       // files written since the index was last saved
    this.treeDirty = false;
    this.settingsJson = "";
  }

  get label() { return this.fileName.replace(/\.scrivx$/i, ""); }

  // Scrivener leaves a .lock file in the project (or its Files folder) while it has the project open
  async findLocks() {
    const out = [];
    for (const parts of [[], ["Files"]]) {
      try {
        const d = await dirAt(this.handle, parts);
        for await (const [name, h] of d.entries()) if (h.kind === "file" && name.toLowerCase().endsWith(".lock")) out.push([...parts, name].join("/"));
      } catch (e) { /* none */ }
    }
    return out;
  }

  paths(info) {
    if (this.v3) {
      const base = `Files/Data/${info.uid}`;
      return { base, content: base + "/content.rtf", notes: base + "/notes.rtf", synopsis: base + "/synopsis.txt", stem: "content" };
    }
    const base = "Files/Docs";
    return { base, content: `${base}/${info.sid}.rtf`, notes: `${base}/${info.sid}_notes.rtf`, synopsis: `${base}/${info.sid}_synopsis.txt`, stem: String(info.sid) };
  }

  // ------------------------------------------------------------ reading
  async scan() {
    const f = await (await this.handle.getFileHandle(this.fileName)).getFile();
    const xtext = (await f.text()).replace(/^\uFEFF/, "");
    const doc = new DOMParser().parseFromString(xtext, "application/xml");
    const root = doc.documentElement;
    if (!root || root.nodeName !== "ScrivenerProject" || doc.getElementsByTagName("parsererror").length) {
      throw new Error("This isn't a Scrivener project (its .scrivx couldn't be read).");
    }
    this.xdoc = doc;
    let hasData = false;
    try { await dirAt(this.handle, ["Files", "Data"]); hasData = true; } catch (e) { hasData = false; }
    this.v3 = !["0", "1"].includes((root.getAttribute("Version") || "1").split(".")[0]) || hasData;
    // labels: id -> [name, rgb]
    this.labels = new Map();
    for (const lab of root.getElementsByTagName("Label")) this.labels.set(lab.getAttribute("ID"), [lab.textContent, rgbOf(lab.getAttribute("Color"))]);
    // Scrivener 1's texts: one folder, listed once
    this.docNames = new Set();
    if (!this.v3) { try { for await (const [name] of (await dirAt(this.handle, ["Files", "Docs"])).entries()) this.docNames.add(name); } catch (e) { /* none */ } }
    // RossDraft's own settings for this project
    let meta = {}, compile = {};
    const sf = await fileAt(this.handle, "Settings/rossdraft.json");
    if (sf) { try { const j = JSON.parse(await sf.text()); meta = j.meta || {}; compile = j.compile || {}; this.settingsJson = JSON.stringify(j); } catch (e) { /* as new */ } }
    this.data = { format: "scrivener", title: this.label, meta, compile, nodes: [] };
    const binder = [...root.children].find((c) => c.nodeName === "Binder");
    const kidsOf = (el) => { const ch = [...el.children].find((c) => c.nodeName === "Children"); return ch ? [...ch.children].filter((c) => c.nodeName === "BinderItem") : []; };
    const metaOf = (el, tag) => { const m = [...el.children].find((c) => c.nodeName === "MetaData"); const t = m && [...m.children].find((c) => c.nodeName === tag); return t ? t.textContent.trim() : null; };
    const read = (el, inDraft) => {
      const type = el.getAttribute("Type") || "Text";
      const uid = el.getAttribute("UUID"), sid = el.getAttribute("ID");
      const title = ([...el.children].find((c) => c.nodeName === "Title") || { textContent: "" }).textContent.trim() || "Untitled";
      const inc = (metaOf(el, "IncludeInCompile") || "Yes").toLowerCase() !== "no";
      const lab = metaOf(el, "LabelID");
      const flag = lab && this.labels.has(lab) ? nearestFlag(this.labels.get(lab)[1]) : "";
      const raw = { id: uid || sid, title, flag, include: inc, expanded: true, scrivType: type, inDraft: inDraft || type === "DraftFolder" };
      this.info.set(raw, { el, uid, sid, type, flag0: flag, title0: title, include0: inc, notes0: "", synopsis0: "" });
      const kids = kidsOf(el);
      if (kids.length) raw.children = kids.map((c) => read(c, raw.inDraft));
      return raw;
    };
    this.data.nodes = binder ? [...binder.children].filter((c) => c.nodeName === "BinderItem").map((c) => read(c, false)) : [];
    // the tree, then each entry's text (a few at once), as ProjectStore.scan
    const all = [];
    const build = (parent, list) => {
      for (const raw of list) {
        const n = new PNote(parent, raw);
        parent.children.push(n);
        all.push(n);
        if (raw.children) build(n, raw.children);
      }
    };
    const top = new PNote(null, null);
    build(top, this.data.nodes);
    let done = 0, next = 0;
    const worker = async () => {
      while (next < all.length) {
        const n = all[next++];
        try { await this.load(n); } catch (e) { n.readOnly = ["couldn't read it: " + ((e && e.message) || e)]; n.text = md.serialize([this.titleLine(n)]); }
        done++;
        if (this.onProgress) this.onProgress(done, all.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, all.length) }, worker));
    this.root = top;
    return top;
  }

  // the Draft's entries are ticked at first in Compile (as Ross Writer)
  compileTicked(n) { return n.raw.include !== false && !!n.raw.inDraft; }
  locked(n) { return SPECIAL.has(n.raw.scrivType); }

  async sceneFile(raw, create = false) {
    const info = this.info.get(raw);
    if (!info) return null;
    const p = this.paths(info).content.split("/");
    try { return [await dirAt(this.handle, p.slice(0, -1), create), p[p.length - 1]]; } catch (e) { return null; }
  }

  async load(n, force = false) {
    const raw = n.raw, info = this.info.get(raw);
    const P = this.paths(info);
    n.comments = undefined;
    n.fnotes = undefined;
    // notes and synopsis (the Synopsis & Notes tab)
    if (!info.notesRead || force) {
      const nf = await fileAt(this.handle, P.notes);
      if (nf) {
        try { raw.notes = rtf.readRtf(new Uint8Array(await nf.arrayBuffer())).lines.map((l) => (l.runs || []).map((r) => r.t || "").join("")).join("\n").trim(); } catch (e) { raw.notes = ""; }
      } else raw.notes = "";
      const sy = await fileAt(this.handle, P.synopsis);
      raw.synopsis = sy ? (await sy.text()).trim() : "";
      if (!raw.notes) delete raw.notes;
      if (!raw.synopsis) delete raw.synopsis;
      info.notes0 = raw.notes || "";
      info.synopsis0 = raw.synopsis || "";
      info.notesRead = true;
    }
    const file = await fileAt(this.handle, P.content);
    if (!file) {
      // a research file (a PDF, a picture, a web page) kept in Scrivener, or an entry with no text yet
      let other = null;
      try {
        const d = await dirAt(this.handle, P.base.split("/"));
        if (this.v3) { for await (const [name, h] of d.entries()) if (h.kind === "file" && name.startsWith("content.") && !name.endsWith(".rtf")) other = name; }
        else for (const name of this.docNames) if (name.startsWith(P.stem + ".") && !name.endsWith(".rtf")) other = name;
      } catch (e) { other = null; }
      this.scenes.set(raw.id, { mtime: 0, look: null, paras: [], readOnly: null, anchors: [], comments: [], entries: new Map(), linkIds: [] });
      n.modified = 0;
      if (!other) n.comments = [];
      if (other) {
        info.other = P.base + "/" + other;
        if (/\.pdf$/i.test(other)) raw.pdf = info.other;
        n.readOnly = ["a research file kept in Scrivener"];
        n.text = md.serialize([this.titleLine(n), { kind: null, mark: null, runs: [] },
          { kind: null, mark: null, runs: [{ t: `A research file kept in Scrivener (${other.split(".").pop().toUpperCase()}).`, f: new Set() }] }]);
        return n.text;
      }
      n.readOnly = this.readOnlyAll;
      n.text = md.serialize([this.titleLine(n)]);
      return n.text;
    }
    const known = this.scenes.get(raw.id);
    if (!force && known && known.mtime === file.lastModified && known.text != null) {
      n.text = known.shown != null && known.shownTitle === n.title() ? known.shown : md.serialize([this.titleLine(n), ...known.noteLines], { dir: [] });
      n.readOnly = known.readOnly;
      n.comments = known.comments || [];
      n.modified = file.lastModified;
      return n.text;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const s = latin1(bytes);
    const why = [];
    if (UNSAFE.some((m) => s.includes(m))) why.push("Scrivener's own inline footnotes");
    // 1.7.0: inline notes are read as marks in the text, and kept beside it
    const inl = [];
    const s2 = s.replace(INLINE, (m0, col, txt) => {
      inl.push({ color: col || RED, text: wordsOfRtf("{\\rtf1\\ansi " + txt + "}") });
      return "{\\uc1\\u-8176?}";
    });
    const got = rtf.readRtf(bytesOf(s2.replace(STYLE_TAG, "")));
    const cm = await this.commentsIn(P, got, inl, why);
    for (const b of got.blockers) if (b !== "comments" && !why.includes(b)) why.push(b);
    const noteLines = wordio.toNoteLines(got.lines, () => null);
    const ro = this.readOnlyAll || (why.length ? why : null);
    const text = md.serialize([this.titleLine(n), ...noteLines], { dir: [] });
    this.scenes.set(raw.id, { mtime: file.lastModified, look: got.look, paras: got.paras, readOnly: ro, noteLines, text, ...cm });
    n.comments = cm.comments;
    n.readOnly = ro;
    n.modified = file.lastModified;
    n.text = text;
    return text;
  }

  async peek(n) {
    const info = this.info.get(n.raw);
    const f = info ? await fileAt(this.handle, this.paths(info).content) : null;
    if (!f) return null;
    return { modified: f.lastModified, text: f.lastModified === n.modified ? n.text : "\u0000changed elsewhere" };
  }

  // ------------------------------------------------------------ the backup: the whole project, zipped, once a visit
  async backup() {
    if (this.noBackup) return null;     // (a project being made: nothing to keep)
    const key = this.handle.name + "/" + this.fileName;
    if (backedUp.has(key)) return null;
    const files = [];
    const walk = async (d, path) => {
      for await (const [name, h] of d.entries()) {
        const p = path ? path + "/" + name : name;
        if (h.kind === "directory") await walk(h, p);
        else files.push([this.handle.name + "/" + p, new Uint8Array(await (await h.getFile()).arrayBuffer()), true]);
      }
    };
    await walk(this.handle, "");
    const zipped = await wordio.zip(files);
    const store = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("backups", { create: true }))
      .getDirectoryHandle("scrivener", { create: true });
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    const name = `${this.handle.name} ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
    const h = await store.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(zipped);
    await w.close();
    const olds = [];
    for await (const [n] of store.entries()) if (n.startsWith(this.handle.name + " ") && n.endsWith(".zip")) olds.push(n);
    olds.sort().reverse();
    for (const o of olds.slice(BACKUPS)) { try { await store.removeEntry(o); } catch (e) { /* kept */ } }
    backedUp.add(key);
    return name;
  }

  // ------------------------------------------------------------ writing a text
  async write(n, text) {
    if (n.readOnly) throw new Error(`“${n.title()}” has ${n.readOnly.join(", ")}: edit it in Scrivener.`);
    const raw = n.raw, info = this.info.get(raw);
    const lines = md.parse(text);
    const ti = lines.findIndex((ln) => ln.runs.some((r) => !r.img && r.t.split(md.OBJ).join("").trim()));
    let body = lines;
    if (ti >= 0) {
      const title = md.titleOfLines([lines[ti]], 1000);
      if (title) raw.title = title;
      body = lines.slice(ti + 1);
    }
    const wl = wordio.fromNoteLines(body);
    const isEmpty = (ln) => !ln.kind && !ln.code && !(ln.runs || []).some((r) => r.img || (r.t || "").trim());
    while (wl.length && isEmpty(wl[0])) wl.shift();
    while (wl.length && isEmpty(wl[wl.length - 1])) wl.pop();
    const sc = this.scenes.get(raw.id) || {};
    const linked = this.placeComments(sc, wl);
    const out = await rtf.writeRtf(wl, { look: sc.look || { font: "Times New Roman", fs: 24, sl: 0, slmult: 0 }, paras: sc.paras || [],
      pictureBytes: (img) => this.pictureBytes(img) });
    await this.backup();
    const P = this.paths(info);
    await writeAt(this.handle, P.content, bytesOf(out));
    this.changed.add(P.content);
    // Scrivener 3's linked comments: their words, in content.comments
    const xml = this.v3 ? this.commentsXml(sc, linked) : null;
    if (xml != null) {
      await writeAt(this.handle, P.base + "/content.comments", enc.encode(xml));
      this.changed.add(P.base + "/content.comments");
    }
    info.el.setAttribute("Modified", now());
    this.treeDirty = true;
    await this.saveProject();
    await this.load(n, true);
    n.text = text;
    const k = this.scenes.get(raw.id);
    if (k) { k.shown = text; k.shownTitle = n.title(); }
  }


  // ------------------------------------------------------------ RossDraft 1.7.0: Scrivener's comments
  // what readRtf found, made into comments kept on their words: { anchors, comments, entries, linkIds }
  async commentsIn(P, got, inl, why) {
    const entries = new Map();
    if (this.v3) {
      const cf = await fileAt(this.handle, P.base + "/content.comments");
      if (cf) {
        try {
          const doc = new DOMParser().parseFromString((await cf.text()).replace(/^﻿/, ""), "application/xml");
          for (const el of doc.getElementsByTagName("Comment")) {
            entries.set(el.getAttribute("ID"), { attrs: [...el.attributes].map((a) => [a.name, a.value]), rtf: el.textContent,
              footnote: /^yes$/i.test(el.getAttribute("Footnote") || "") });
          }
        } catch (e) { /* none read */ }
      }
    }
    const lines = got.lines;
    const starts = [];
    let b = 0;
    for (const ln of lines) { starts.push(b); b += plainOf(ln).length + 1; }
    const offOf = (p) => (p ? (starts[p.line] != null ? starts[p.line] : Math.max(0, b - 1)) + p.pos : null);
    // the inline notes' marks and the linked comments' words, taken out of the text (at their places as read)
    const marks = [], links = [];
    let base = 0;
    for (const ln of lines) {
      let pos = 0;
      const out = [];
      for (const r of ln.runs || []) {
        if (r.img) { out.push(r); continue; }
        const t = r.t || "";
        const id = r.href && r.href.startsWith("scrivcmt://") ? r.href.slice(11) : null;
        let clean = "";
        for (let i = 0; i < t.length; i++) { if (t[i] === MARK) marks.push(base + pos + i); else clean += t[i]; }
        if (id) {
          const last = links[links.length - 1];
          if (last && last.id === id && last.e === base + pos) last.e = base + pos + t.length;
          else links.push({ id, s: base + pos, e: base + pos + t.length });
        }
        const nr = { ...r, t: clean, href: id ? null : r.href };
        const prev = out[out.length - 1];
        const same = (x, y) => [...(x.f || [])].sort().join("") === [...(y.f || [])].sort().join("");
        if (!clean) { /* nothing left */ }
        else if (prev && !prev.img && !prev.href && !nr.href && same(prev, nr)) prev.t += clean;
        else out.push(nr);
        pos += t.length;
      }
      ln.runs = out;
      base += pos + 1;
    }
    const adj = (o) => o - marks.filter((m) => m < o).length;
    const plain = lines.map(plainOf).join("\n");
    const anchors = [];
    // a note at a place, on the word before it (and what came between)
    const pointAt = (at) => {
      const m = /([\p{L}\p{N}'’-]+)([^\p{L}\p{N}]*)$/u.exec(plain.slice(Math.max(0, at - 300), at));
      return m ? { start: at - m[0].length, end: at - m[2].length, words: m[1], tail: m[2], point: true } : { start: at, end: at, words: "", tail: "", point: true };
    };
    marks.forEach((m, k) => anchors.push({ kind: "inline", ...pointAt(adj(m)), text: inl[k] ? inl[k].text : "", color: inl[k] ? inl[k].color : RED }));
    for (const c of got.comments || []) {
      const who = { text: c.text, author: c.author, initials: c.initials, date: c.date };
      if (c.span) {
        const s0 = adj(offOf(c.span[0])), e0 = adj(offOf(c.span[1]));
        anchors.push({ kind: "atn", start: s0, end: e0, words: plain.slice(s0, e0), ...who });
      } else anchors.push({ kind: "atn", ...pointAt(adj(offOf(c.at) || 0)), ...who });
    }
    for (const l of links) {
      const e = entries.get(l.id);
      if (e && e.footnote) { if (!why.includes("Scrivener's own linked footnotes")) why.push("Scrivener's own linked footnotes"); continue; }
      const s0 = adj(l.s), e0 = adj(l.e);
      const text = e ? wordsOfRtf(e.rtf) : "";
      anchors.push({ kind: "link", id: l.id, start: s0, end: e0, words: plain.slice(s0, e0), text, text0: text });
    }
    anchors.sort((x, y) => x.start - y.start);
    return { anchors, entries, linkIds: links.map((l) => l.id), comments: commentList(anchors) };
  }

  // the comments put back into the lines being written, each on its words as they now are; gives the linked ones
  placeComments(sc, wl) {
    const anchors = sc.anchors || [];
    if (!anchors.length) return [];
    const plain = wl.map(plainOf).join("\n");
    const ins = [], linked = [];
    let ref = 0;
    for (const a of anchors) {
      let [s0, e0] = placeAnchor(a, plain);
      const nl = plain.indexOf("\n", s0);
      if (nl >= 0 && e0 > nl) e0 = nl;          // within its paragraph
      let at = e0;
      if (a.point && a.tail && plain.slice(e0, e0 + a.tail.length) === a.tail) at += a.tail.length;
      if (a.kind === "inline") {
        ins.push({ off: at, order: 1, raw: `{\\Scrv_annot ${a.color || RED} \\text=${rtf.esc(a.text || "")}\\end_Scrv_annot}` });
      } else if (a.kind === "link") {
        const open = `{\\field{\\*\\fldinst{HYPERLINK "scrivcmt://${a.id}"}}{\\fldrslt `;
        if (e0 > s0) { ins.push({ off: s0, order: 2, raw: open }); ins.push({ off: e0, order: 0, raw: "}}" }); }
        else ins.push({ off: s0, order: 1, raw: open + "}}" });
        linked.push(a);
      } else {
        ref++;
        const d = dttmOf(a.date);
        const note = `{\\*\\atnid ${rtf.esc(a.initials || "")}}{\\*\\atnauthor ${rtf.esc(a.author || "")}}\\chatn` +
          `{\\*\\annotation{\\*\\atnref ${ref}}${d != null && a.date ? `{\\*\\atndate ${d}}` : ""} ${(a.text || "").split("\n").map(rtf.esc).join("\\par ")}}`;
        if (a.point || e0 <= s0) ins.push({ off: at, order: 1, raw: note });
        else { ins.push({ off: s0, order: 2, raw: `{\\*\\atrfstart ${ref}}` }); ins.push({ off: e0, order: 0, raw: `{\\*\\atrfend ${ref}}` + note }); }
      }
    }
    putRaw(wl, ins);
    return linked;
  }

  // content.comments as it should now be (null: as it is)
  commentsXml(sc, linked) {
    const entries = new Map(sc.entries || []);
    let dirty = false;
    for (const id of sc.linkIds || []) if (!linked.some((a) => a.id === id) && entries.has(id)) { entries.delete(id); dirty = true; }
    for (const a of linked) {
      const e = entries.get(a.id);
      if (e && a.text === a.text0) continue;
      entries.set(a.id, { attrs: e ? e.attrs : [["ID", a.id], ["Footnote", "No"]], rtf: rtfText(a.text || "") });
      dirty = true;
    }
    if (!dirty) return null;
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', "<Comments>"];
    for (const [, e] of entries) {
      out.push(`<Comment ${e.attrs.map(([k, v]) => `${k}="${xmlEsc(v)}"`).join(" ")}><![CDATA[${e.rtf.split("]]>").join("]]]]><![CDATA[>")}]]></Comment>`);
    }
    out.push("</Comments>", "");
    return out.join("\n");
  }

  // a change to an entry's comments ({kind: add|edit|delete}, as ProjectStore.commentOp); no replies or resolving
  async commentOp(n, op) {
    if (this.readOnlyAll) throw new Error("This project is open read-only (Scrivener has it open).");
    if (n.readOnly) throw new Error(`“${n.title()}” has ${n.readOnly.join(", ")}: edit it in Scrivener.`);
    let sc = this.scenes.get(n.raw.id);
    if (!sc || !sc.anchors) { const keep = n.text; await this.load(n); n.text = keep; sc = this.scenes.get(n.raw.id); }
    const anchors = sc.anchors = (sc.anchors || []).map((a) => ({ ...a }));
    const k = op.id != null ? +op.id - 1 : -1;
    if (op.kind === "add") {
      const L = op.pageLines || [];
      if (op.a.line < 1) throw new Error("Select words in the text, not the title.");
      let off = 0;
      for (let i = 1; i < op.a.line; i++) off += (L[i] || "").length + 1;
      const end = op.b.line === op.a.line ? op.b.pos : (L[op.a.line] || "").length;
      const words = (L[op.a.line] || "").slice(op.a.pos, end);
      const add = { start: off + op.a.pos, end: off + end, words, text: op.text, author: op.author || "", initials: op.initials || "",
        date: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
      if (this.v3) anchors.push({ kind: "link", id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).toUpperCase(), ...add });
      else anchors.push({ kind: "atn", ...add });
      anchors.sort((x, y) => x.start - y.start);
    } else if (op.kind === "edit") {
      if (!anchors[k]) throw new Error("That comment isn't there any more.");
      anchors[k].text = op.text;
    } else if (op.kind === "delete") {
      if (!anchors[k]) throw new Error("That comment isn't there any more.");
      anchors.splice(k, 1);
    } else throw new Error("Scrivener's comments have no replies or resolving: edit or delete them instead.");
    await this.write(n, n.text);
    return n.comments;
  }

  // ------------------------------------------------------------ the index, notes and synopses
  async saveProject() {
    if (this.readOnlyAll) return;
    const root = this.xdoc.documentElement;
    const stamp = now();
    const all = [];
    const walk = (list) => { for (const r of list) { all.push(r); if (r.children) walk(r.children); } };
    walk(this.data.nodes);
    let backed = false;
    const needBackup = async () => { if (!backed) { await this.backup(); backed = true; } };
    // notes and synopses typed in RossDraft
    for (const raw of all) {
      const info = this.info.get(raw);
      if (!info) continue;
      const P = this.paths(info);
      if ((raw.notes || "") !== info.notes0) {
        await needBackup();
        const lines = String(raw.notes || "").split("\n").map((t) => ({ kind: null, depth: 1, runs: [{ t, f: new Set() }] }));
        await writeAt(this.handle, P.notes, bytesOf(await rtf.writeRtf(lines, { look: { font: "Times New Roman", fs: 24, sl: 0, slmult: 0 } })));
        info.notes0 = raw.notes || "";
        this.changed.add(P.notes);
      }
      if ((raw.synopsis || "") !== info.synopsis0) {
        await needBackup();
        await writeAt(this.handle, P.synopsis, enc.encode(raw.synopsis || ""));
        info.synopsis0 = raw.synopsis || "";
        this.changed.add(P.synopsis);
      }
    }
    // the tree: titles, order, nesting, Include in Compile, labels (as Ross Writer's save_scriv)
    const binder = [...root.children].find((c) => c.nodeName === "Binder");
    const child = (el, tag) => [...el.children].find((c) => c.nodeName === tag) || null;
    const ensure = (el, tag) => child(el, tag) || el.appendChild(this.xdoc.createElement(tag));
    const place = (parentEl, list) => {
      const want = list.map((r) => this.info.get(r).el);
      const have = [...parentEl.children].filter((c) => c.nodeName === "BinderItem");
      if (want.length !== have.length || want.some((e, i) => e !== have[i])) {
        this.treeDirty = true;
        for (const e of have) parentEl.removeChild(e);
        for (const e of want) { if (e.parentNode) e.parentNode.removeChild(e); parentEl.appendChild(e); }
      }
      for (const r of list) {
        const info = this.info.get(r), el = info.el;
        // an entry made here with entries under it: a Scrivener folder (as Ross Writer makes chapters)
        if (info.fresh && r.scrivType === "Text" && r.children && r.children.length) r.scrivType = "Folder";
        if (r.scrivType && el.getAttribute("Type") !== r.scrivType && !SPECIAL.has(r.scrivType)) {
          el.setAttribute("Type", r.scrivType);
          this.treeDirty = true;
        }
        if (r.title !== info.title0) {
          ensure(el, "Title").textContent = r.title;
          info.title0 = r.title;
          el.setAttribute("Modified", stamp);
          this.treeDirty = true;
        }
        if ((r.include !== false) !== info.include0) {
          ensure(ensure(el, "MetaData"), "IncludeInCompile").textContent = r.include !== false ? "Yes" : "No";
          info.include0 = r.include !== false;
          this.treeDirty = true;
        }
        if ((r.flag || "") !== info.flag0) {
          this.setLabel(el, r.flag || "");
          info.flag0 = r.flag || "";
          this.treeDirty = true;
        }
        let ch = child(el, "Children");
        if (r.children && r.children.length) {
          if (!ch) ch = el.appendChild(this.xdoc.createElement("Children"));
          place(ch, r.children);
        } else if (ch && [...ch.children].some((c) => c.nodeName === "BinderItem")) {
          for (const c of [...ch.children]) if (c.nodeName === "BinderItem") ch.removeChild(c);
          this.treeDirty = true;
        }
        if (ch && !ch.children.length) el.removeChild(ch);
      }
    };
    if (binder) place(binder, this.data.nodes);
    if (this.treeDirty) {
      await needBackup();
      root.setAttribute("Modified", stamp);
      root.setAttribute("ModID", newUuid());
      const data = enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root) + "\n");
      await writeAt(this.handle, this.fileName, data);
      // Scrivener's own copy of the index, so it doesn't open an older one
      if (await fileAt(this.handle, "Files/binder.autosave")) await writeAt(this.handle, "Files/binder.autosave", await wordio.zip([[this.fileName, data, true]]));
      this.treeDirty = false;
    }
    // the files Scrivener checks for changes made elsewhere: it looks at ours afresh
    if (this.changed.size) {
      const ck = this.v3 ? "Files/Data/docs.checksum" : "Files/Docs/docs.checksum";
      const cf = await fileAt(this.handle, ck);
      if (cf) {
        const base = this.v3 ? "Files/Data/" : "Files/Docs/";
        const names = new Set([...this.changed].map((f) => f.slice(base.length)));
        const lines = (await cf.text()).split(/\r?\n/).filter(Boolean);
        const keep = lines.filter((ln) => !names.has(ln.split("=")[0]));
        if (keep.length !== lines.length) await writeAt(this.handle, ck, enc.encode(keep.join("\n") + "\n"));
      }
      this.changed.clear();
    }
    // RossDraft's own settings for the project
    const mine = JSON.stringify({ meta: this.data.meta || {}, compile: this.data.compile || {} });
    if (mine !== this.settingsJson && (Object.keys(this.data.meta || {}).length || Object.keys(this.data.compile || {}).length)) {
      await writeAt(this.handle, "Settings/rossdraft.json", enc.encode(JSON.stringify(JSON.parse(mine), null, 1)));
      this.settingsJson = mine;
    }
  }

  setLabel(el, flag) {
    const md0 = [...el.children].find((c) => c.nodeName === "MetaData") || el.appendChild(this.xdoc.createElement("MetaData"));
    let lab = [...md0.children].find((c) => c.nodeName === "LabelID");
    if (!flag) { if (lab) md0.removeChild(lab); return; }
    let best = null;
    for (const [id, [, rgb]] of this.labels) if (rgb && nearestFlag(rgb) === flag) { best = id; break; }
    if (best == null) {
      const labels = this.xdoc.querySelector("LabelSettings > Labels");
      if (!labels) return;
      const ids = [...this.labels.keys()].map(Number).filter((x) => !isNaN(x));
      best = String(Math.max(0, ...ids) + 1);
      const hex = FLAG_COLOURS[flag];
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const e = this.xdoc.createElement("Label");
      e.setAttribute("ID", best);
      e.setAttribute("Color", rgb.map((v) => v.toFixed(6)).join(" "));
      e.textContent = flag[0].toUpperCase() + flag.slice(1);
      labels.appendChild(e);
      this.labels.set(best, [e.textContent, rgb]);
    }
    if (!lab) lab = md0.appendChild(this.xdoc.createElement("LabelID"));
    lab.textContent = best;
  }

  // ------------------------------------------------------------ the tree
  newElement(title, include = true) {
    const el = this.xdoc.createElement("BinderItem");
    const uid = newUuid();
    let sid = null;
    if (!this.v3) {
      let mx = 100;
      for (const e of this.xdoc.getElementsByTagName("BinderItem")) { const v = parseInt(e.getAttribute("ID"), 10); if (!isNaN(v)) mx = Math.max(mx, v); }
      sid = String(mx + 1);
      el.setAttribute("ID", sid);
    }
    el.setAttribute("UUID", uid);
    el.setAttribute("Type", "Text");
    el.setAttribute("Created", now());
    el.setAttribute("Modified", now());
    const t = this.xdoc.createElement("Title");
    t.textContent = title;
    const m = this.xdoc.createElement("MetaData");
    const inc = this.xdoc.createElement("IncludeInCompile");
    inc.textContent = include ? "Yes" : "No";
    m.appendChild(inc);
    el.append(t, m);
    return { el, uid, sid };
  }

  async newNote(parent, index = null, text = "") {
    if (this.readOnlyAll) throw new Error("This project is open read-only (Scrivener has it open).");
    const { el, uid, sid } = this.newElement("Untitled");
    const raw = { id: this.v3 ? uid : sid, title: "Untitled", flag: "", include: true, expanded: true, scrivType: "Text",
      inDraft: !parent.isRoot() && !!parent.raw.inDraft };
    this.info.set(raw, { el, uid, sid, type: "Text", flag0: "", title0: "Untitled", include0: true, notes0: "", synopsis0: "", notesRead: true, fresh: true });
    const n = new PNote(parent, raw);
    const list = this.rawList(parent);
    if (index == null || index >= parent.children.length) { parent.children.push(n); list.push(raw); }
    else {
      const before = parent.children[index];
      parent.children.splice(index, 0, n);
      list.splice(list.indexOf(before.raw), 0, raw);
    }
    this.treeDirty = true;
    this.scenes.set(raw.id, { mtime: 0, look: null, paras: [], readOnly: null });
    await this.write(n, text || "");
    return n;
  }

  async rename(n, title) {
    if (this.locked(n)) return false;
    return super.rename(n, title);
  }

  async move(n, newParent, index) {
    if (this.locked(n)) return false;
    const ok = await super.move(n, newParent, index);
    if (ok) for (const x of [n, ...n.walk()]) x.raw.inDraft = !newParent.isRoot() && !!newParent.raw.inDraft || x.raw.scrivType === "DraftFolder";
    return ok;
  }

  // as Scrivener: into its Trash folder (its files stay, as Scrivener keeps them)
  async delete(n) {
    if (this.locked(n)) throw new Error(`“${n.title()}” is one of Scrivener's own folders: it can't be deleted.`);
    const trash = this.root.children.find((c) => c.raw.scrivType === "TrashFolder");
    if (!trash || n === trash || [...trash.walk()].includes(n)) throw new Error("It's in Scrivener's Trash already: empty the Trash in Scrivener.");
    await this.move(n, trash, trash.children.length);
  }

  // another device's version of a text, kept in RossDraft's backups before ours replaces it
  async keepConflict(n) {
    const info = this.info.get(n.raw);
    const f = info ? await fileAt(this.handle, this.paths(info).content) : null;
    if (!f) return;
    const store = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("backups", { create: true }))
      .getDirectoryHandle("scrivener", { create: true });
    const h = await store.getFileHandle(`${this.handle.name} ${n.title().replace(/[\\/:*?"<>|]+/g, " ")} (other version ${Date.now()}).rtf`, { create: true });
    const w = await h.createWritable();
    await w.write(f);
    await w.close();
  }

  async findTemplate() { return null; }

  // RossDraft 1.4: a research file's PDF
  async pdfFile(n) {
    const info = this.info.get(n.raw);
    return info && info.other && /\.pdf$/i.test(info.other) ? fileAt(this.handle, info.other) : null;
  }

  // a PDF entry: a Scrivener PDF document (left out of Compile), its file content.pdf (Scrivener 3) or <ID>.pdf
  async addPdf(parent, index, title, file) {
    if (this.readOnlyAll) throw new Error("This project is open read-only (Scrivener has it open).");
    const { el, uid, sid } = this.newElement(title, false);
    el.setAttribute("Type", "PDF");
    const m = [...el.children].find((c) => c.nodeName === "MetaData");
    const fe = this.xdoc.createElement("FileExtension");
    fe.textContent = "pdf";
    m.appendChild(fe);
    const raw = { id: this.v3 ? uid : sid, title, flag: "", include: false, expanded: true, scrivType: "PDF",
      inDraft: !parent.isRoot() && !!parent.raw.inDraft };
    const info = { el, uid, sid, type: "PDF", flag0: "", title0: title, include0: false, notes0: "", synopsis0: "", notesRead: true };
    this.info.set(raw, info);
    const P = this.paths(info);
    const path = this.v3 ? P.base + "/content.pdf" : `${P.base}/${sid}.pdf`;
    await this.backup();
    await writeAt(this.handle, path, file);
    if (!this.v3) this.docNames.add(`${sid}.pdf`);
    const n = new PNote(parent, raw);
    const list = this.rawList(parent);
    if (index == null || index >= parent.children.length) { parent.children.push(n); list.push(raw); }
    else { const before = parent.children[index]; parent.children.splice(index, 0, n); list.splice(list.indexOf(before.raw), 0, raw); }
    this.treeDirty = true;
    await this.saveProject();
    await this.load(n, true);
    return n;
  }
}

// ------------------------------------------------------------------ RossDraft's Scrivener backups
export async function listBackups() {
  try {
    const store = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("backups")).getDirectoryHandle("scrivener");
    const out = [];
    for await (const [name, h] of store.entries()) if (h.kind === "file") out.push([name, h]);
    return out.sort((a, b) => b[0].localeCompare(a[0]));
  } catch (e) { return []; }
}

// ------------------------------------------------------------------ a new Scrivener project
// A copy of Scrivener's Novel template (as Scrivener 3 writes it; Ross Writer's own), its sample chapter taken
// out, under a name and identity of its own. Its Draft is empty: the app adds the first chapter and scene, or
// brings a Word document in, as for a Ross Writer project.
const TEMPLATE = "vendor/scrivtemplate/Novel.scriv/";
const TEMPLATE_FILES = ["Novel.scrivx", "Files/styles.xml", "Files/version.txt", "Files/search.indexes", "Files/Data/docs.checksum",
  "Settings/compile.xml", "Settings/recents.txt", "Settings/templateinfo.xml", "Settings/favorites.xml",
  "Settings/projectpreferences.xml", "Settings/ui.ini", "Settings/ui-common.xml"];
const SAMPLE_UUIDS = ["FD75AC3C-F304-4EA6-ADCC-2C32D6589969", "0A7EDD9F-9DE0-4CC9-9AC1-EE0E3769B6A8"];

export async function makeScrivener(where, title) {
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled";
  const taken = new Set();
  for await (const [n] of where.entries()) taken.add(n);
  let name = safe, k = 2;
  while (taken.has(name + ".scriv")) name = `${safe} (${k++})`;
  const dir = await where.getDirectoryHandle(name + ".scriv", { create: true });
  const get = async (p) => {
    const r = await fetch(TEMPLATE + p);
    if (!r.ok) throw new Error(`Scrivener's template isn't on this device (${p}): connect to the internet once, then try again.`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const dec = new TextDecoder();
  for (const d of [["Icons"], ["Snapshots"], ["Files", "ProjectNotes"], ["Files", "Data"]]) await dirAt(dir, d, true);
  // the index: a new identity, the sample chapter out of the Draft
  const xdoc = new DOMParser().parseFromString(dec.decode(await get("Novel.scrivx")), "application/xml");
  const root = xdoc.documentElement;
  const stamp = now();
  root.setAttribute("Identifier", newUuid());
  root.setAttribute("Modified", stamp);
  root.setAttribute("ModID", newUuid());
  const draft = [...xdoc.getElementsByTagName("BinderItem")].find((e) => e.getAttribute("Type") === "DraftFolder");
  const ch = draft && [...draft.children].find((c) => c.nodeName === "Children");
  if (ch) draft.removeChild(ch);
  const data = enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root) + "\n");
  const xname = name + ".scrivx";
  await writeAt(dir, xname, data);
  for (const b of ["Files/binder.autosave", "Files/binder.backup"]) await writeAt(dir, b, await wordio.zip([[xname, data, true]]));
  for (const p of TEMPLATE_FILES.slice(1)) {
    let bytes = await get(p);
    if (p === "Files/search.indexes" || p.startsWith("Settings/")) {
      // the template's sample chapter mentioned nowhere
      let s = dec.decode(bytes);
      for (const u of SAMPLE_UUIDS) {
        s = s.replace(new RegExp(`<Document ID="${u}">[\\s\\S]*?</Document>\\s*`, "g"), "");
        s = s.replace(new RegExp(`(\\\\n|\\n)[ \\t]*<ItemID>${u}</ItemID>`, "g"), "");
        s = s.split(", " + u).join("").split(u + ", ").join("");
        s = s.split("\n").filter((ln) => ln.trim() !== u).join("\n");
      }
      bytes = enc.encode(s);
    }
    await writeAt(dir, p, bytes);
  }
  return [dir, xname];
}
