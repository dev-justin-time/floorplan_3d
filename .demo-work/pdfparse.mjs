import fs from 'node:fs';
import zlib from 'node:zlib';

// Minimal PDF parser: objects, pages, content streams, vector + text extraction.
const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin = buf.toString('latin1');

// --- collect objects via the xref table (exact offsets; streams may contain "endobj")
function readXref(at) {
  const entries = [];
  const sec = latin.slice(at);
  const lines = sec.split('\n');
  let i = 1; // skip 'xref'
  while (i < lines.length) {
    const head = lines[i].match(/(\d+)\s+(\d+)/);
    if (!head) break;
    let num = +head[1];
    const count = +head[2];
    i++;
    for (let k = 0; k < count; k++, i++, num++) {
      const e = (lines[i] || '').match(/(\d+)\s+(\d+)\s+([fn])/);
      if (e && e[3] === 'n') entries.push({ num, gen: +e[2], off: +e[1] });
    }
    if (/trailer/i.test(lines[i] || '')) break;
  }
  return entries;
}
const objs = new Map();
{
  const xms = latin.match(/startxref\s+(\d+)/);
  const entries = readXref(+xms[1]);
  for (const { num, gen, off } of entries) {
    const head = latin.slice(off, off + 60);
    const hm = head.match(/(\d+)\s+(\d+)\s+obj/);
    if (!hm) continue;
    const bodyStart = off + hm[0].length;
    // If a stream with a direct /Length follows, compute the exact end.
    let end;
    const dictProbe = latin.slice(bodyStart, bodyStart + 2000);
    const streamIdx = dictProbe.search(/stream(\r\n|\r|\n)/);
    const lenM = dictProbe.match(/\/Length\s+(\d+)\s/);
    if (streamIdx >= 0 && lenM && lenM.index < streamIdx) {
      // Direct /Length before the stream keyword: exact end, immune to
      // 'endobj' bytes inside the binary payload.
      const eol = dictProbe.slice(streamIdx).match(/^stream(\r\n|\r|\n)/)[0].length;
      const dataStart = bodyStart + streamIdx + eol;
      end = dataStart + (+lenM[1]);
      // skip endstream + endobj
      const tail = latin.slice(end, end + 30);
      const em = tail.match(/endstream\s*endobj/);
      end = end + (em ? em[0].length : 20);
    } else {
      const tail = latin.indexOf('endobj', bodyStart);
      end = tail + 6;
    }
    objs.set(`${num} ${gen}`, { num, gen, body: latin.slice(bodyStart, end - 6), start: off, bodyStart });
  }
}
console.log('objects:', objs.size);
let m;

function refTarget(s) {
  const r = s.match(/(\d+)\s+(\d+)\s+R/);
  return r ? `${+r[1]} ${+r[2]}` : null;
}
function streamBytes(body) {
  const sm = body.match(/stream\r?\n/);
  if (!sm) return null;
  const start = body.indexOf(sm[0]) + sm[0].length;
  const end = body.indexOf('endstream', start);
  // map back to buffer offsets: body is a slice of latin starting at obj start...
  return { start, end };
}
// We need buffer offsets: recompute by locating body in buf via latin index.
function rawStreamOf(key) {
  const o = objs.get(key);
  if (!o) return null;
  const objLatinStart = o.start;
  const sm = /stream\r?\n/.exec(o.body);
  if (!sm) return null;
  const absStart = objLatinStart + sm.index + sm[0].length;
  const absEnd = latin.indexOf('endstream', absStart);
  let raw = buf.subarray(absStart, absEnd);
  const filters = [];
  const fsec = o.body.slice(0, sm.index);
  const fm = fsec.match(/\/Filter\s*(\[[^\]]*\]| Volts|\/\w+)/);
  return { raw, filters: fsec };
}
function decodeStream(key) {
  const o = objs.get(key);
  if (!o) return null;
  const sm = /stream\r?\n/.exec(o.body);
  if (!sm) return null;
  const absStart = o.bodyStart + sm.index + sm[0].length;
  const absEnd = latin.indexOf('endstream', absStart);
  let raw = buf.subarray(absStart, absEnd);
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) raw = raw.subarray(0, raw.length - 1);
  const head = o.body.slice(0, sm.index);
  const fmatch = head.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
  const filters = fmatch ? fmatch[1] : '';
  // apply decode in listed order
  const list = [...filters.matchAll(/\/(\w+)/g)].map((x) => x[1]);
  let data = raw;
  for (const f of list) {
    if (f === 'FlateDecode') {
      try { data = zlib.inflateSync(data); } catch (e) { /* keep */ }
    } else break; // DCT etc: keep raw
  }
  return { data, filters: list };
}

// --- find catalog -> pages
function findByType(t) {
  const out = [];
  for (const [k, o] of objs) if (new RegExp(`/Type\\s*/${t}\\b`).test(o.body)) out.push(k);
  return out;
}
let pagesRoots = findByType('Pages');
console.log('Pages roots:', pagesRoots);
// Prefer the trailer's real catalog root to avoid double-counting embedded trees.
const trailer = latin.match(/trailer\s*<<([\s\S]*?)>>\s*startxref/);
if (trailer) {
  const root = trailer[1].match(/\/Root\s*(\d+)\s+(\d+)\s+R/);
  if (root) {
    const catalog = objs.get(`${+root[1]} ${+root[2]}`);
    const pages = catalog && catalog.body.match(/\/Pages\s*(\d+)\s+(\d+)\s+R/);
    if (pages) pagesRoots = [`${+pages[1]} ${+pages[2]}`];
    console.log('trailer root pages:', pagesRoots);
  }
}
function kidsOf(key) {
  const o = objs.get(key);
  const arr = o.body.match(/\/Kids\s*\[([^\]]*)\]/);
  if (!arr) return [];
  return [...arr[1].matchAll(/(\d+)\s+(\d+)\s+R/g)].map((r) => `${+r[1]} ${+r[2]}`);
}
function allPages(root) {
  let out = [];
  for (const k of kidsOf(root)) {
    const o = objs.get(k);
    if (/\/Type\s*\/Pages/.test(o.body)) out = out.concat(allPages(k));
    else out.push(k);
  }
  return out;
}
let pageKeys = [];
for (const r of pagesRoots) pageKeys = pageKeys.concat(allPages(r));
console.log('page count:', pageKeys.length);

// --- tokenize content stream ---
function tokenize(s) {
  const toks = [];
  const re = /(\[|\]|<<|>>|\/[^\s<>\[\]()\/%]+|\([^)]*\)|<[0-9a-fA-F]+>|-?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z'"]+[A-Za-z0-9'*"]*)/g;
  let mm;
  while ((mm = re.exec(s))) toks.push(mm[0]);
  return toks;
}
function parseText(toks) {
  // returns array of {text, x, y} in text space (approx: track Tm/Td/TJ ops minimally)
  return [];
}

const summary = [];
pageKeys.forEach((pk, pi) => {
  const o = objs.get(pk);
  const mb = o.body.match(/\/MediaBox\s*\[([^\]]*)\]/);
  const media = mb ? mb[1].trim().split(/\s+/).map(Number) : [0, 0, 612, 792];
  const cm = o.body.match(/\/Contents\s*(\[[^\]]*\]|(\d+)\s+(\d+)\s+R)/);
  let contentKeys = [];
  if (cm) {
    if (cm[2]) contentKeys = [`${+cm[2]} ${+cm[3]}`];
    else contentKeys = [...cm[1].matchAll(/(\d+)\s+(\d+)\s+R/g)].map((r) => `${+r[1]} ${+r[2]}`);
  }
  let ops = '';
  for (const ck of contentKeys) {
    const d = decodeStream(ck);
    if (d && d.filters.includes('FlateDecode')) ops += d.data.toString('latin1') + '\n';
    else if (d) ops += '[non-flate stream:' + d.filters.join(',') + ' len=' + d.data.length + ']\n';
  }
  // crude counts
  const nM = (ops.match(/(?<![A-Za-z])m(?![A-Za-z])/g) || []).length;
  const nL = (ops.match(/(?<![A-Za-z])l(?![A-Za-z])/g) || []).length;
  const nS = (ops.match(/(?<![A-Za-z])S(?![A-Za-z])/g) || []).length;
  const nTj = (ops.match(/Tj|TJ/g) || []).length;
  const nRe = (ops.match(/(?<![A-Za-z])re(?![A-Za-z])/g) || []).length;
  // page label: look for text near top? just report
  summary.push({ page: pi + 1, key: pk, media, contents: contentKeys, opsLen: ops.length, m: nM, l: nL, s: nS, re: nRe, tj: nTj });
  fs.writeFileSync(`.demo-work/page-${pi + 1}.ops.txt`, ops.slice(0, 200000));
});
console.log(JSON.stringify(summary.map(({ page, media, m, l, s, re, tj, opsLen }) => ({ page, media, m, l, s, re, tj, opsLen })), null, 1));
