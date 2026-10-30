import fs from 'node:fs';
import zlib from 'node:zlib';

// Stage 2: follow /Do Form XObjects, collect transformed vector segments + text.
const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin = buf.toString('latin1');

function readXref(at) {
  const entries = [];
  const sec = latin.slice(at);
  const lines = sec.split('\n');
  let i = 1;
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
  for (const { num, gen, off } of readXref(+xms[1])) {
    const head = latin.slice(off, off + 60);
    const hm = head.match(/(\d+)\s+(\d+)\s+obj/);
    if (!hm) continue;
    const bodyStart = off + hm[0].length;
    const dictProbe = latin.slice(bodyStart, bodyStart + 4000);
    const streamIdx = dictProbe.search(/stream(\r\n|\r|\n)/);
    const lenM = dictProbe.match(/\/Length\s+(\d+)\s/);
    let end;
    if (streamIdx >= 0 && lenM && lenM.index < streamIdx) {
      const eol = dictProbe.slice(streamIdx).match(/^stream(\r\n|\r|\n)/)[0].length;
      end = bodyStart + streamIdx + eol + (+lenM[1]);
    } else {
      end = latin.indexOf('endobj', bodyStart);
    }
    objs.set(`${num} ${gen}`, { num, gen, body: latin.slice(bodyStart, end), bodyStart });
  }
}
console.log('objects:', objs.size);

function decodeBody(o) {
  const sm = /stream(\r\n|\r|\n)/.exec(o.body);
  if (!sm) return null;
  let raw = buf.subarray(o.bodyStart + sm.index + sm[0].length, o.bodyStart + o.body.length);
  // trim trailing endstream etc: find endstream
  const rawLatin = raw.toString('latin1');
  const ei = rawLatin.indexOf('endstream');
  if (ei >= 0) raw = raw.subarray(0, ei);
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d || raw[raw.length - 1] === 0x20)) raw = raw.subarray(0, raw.length - 1);
  const head = o.body.slice(0, sm.index);
  const fmatch = head.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
  const filters = fmatch ? [...fmatch[1].matchAll(/\/(\w+)/g)].map((x) => x[1]) : [];
  let data = raw;
  for (const f of filters) {
    if (f === 'FlateDecode') { try { data = zlib.inflateSync(data); } catch (e) { return { data: null, filters }; } }
    else if (f === 'ASCII85Decode' || f === 'ASCIIHexDecode') { return { data: null, filters }; }
  }
  return { data, filters };
}

const trailer = latin.match(/trailer\s*<<([\s\S]*?)>>\s*startxref/);
const rootRef = trailer[1].match(/\/Root\s*(\d+)\s+(\d+)\s+R/);
const catalog = objs.get(`${+rootRef[1]} ${+rootRef[2]}`);
const pagesRef = catalog.body.match(/\/Pages\s*(\d+)\s+(\d+)\s+R/);
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
const pageKeys = allPages(`${+pagesRef[1]} ${+pagesRef[2]}`);
console.log('pages:', pageKeys.length);

function xobjectsOf(pageBody) {
  const res = pageBody.match(/\/Resources\s*<<([\s\S]*?)>>\s*(>>)?/);
  // crude: find all /Name N G R after /XObject
  const xo = pageBody.match(/\/XObject\s*<<([^>]*)>>/);
  if (!xo) return {};
  const map = {};
  for (const mm of xo[1].matchAll(/\/(\S+)\s+(\d+)\s+(\d+)\s+R/g)) map[mm[1]] = `${+mm[2]} ${+mm[3]}`;
  return map;
}
function contentsOf(pageBody) {
  const cm = pageBody.match(/\/Contents\s*(\[[^\]]*\]|(\d+)\s+(\d+)\s+R)/);
  if (!cm) return [];
  if (cm[2]) return [`${+cm[2]} ${+cm[3]}`];
  return [...cm[1].matchAll(/(\d+)\s+(\d+)\s+R/g)].map((r) => `${+r[1]} ${+r[2]}`);
}

// tokenizer: numbers, names, strings, hex, arrays, operators
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '%') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let depth = 1, j = i + 1, out = '';
      while (j < s.length && depth > 0) {
        if (s[j] === '\\') { out += s[j] + (s[j + 1] || ''); j += 2; continue; }
        if (s[j] === '(') depth++;
        if (s[j] === ')') depth--;
        if (depth > 0) out += s[j];
        j++;
      }
      toks.push({ t: 'str', v: out }); i = j; continue;
    }
    if (c === '<' && s[i + 1] === '<') { toks.push({ t: 'dict', v: '<<' }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { toks.push({ t: 'dict', v: '>>' }); i += 2; continue; }
    if (c === '<') {
      const j = s.indexOf('>', i);
      toks.push({ t: 'hex', v: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (c === '[' || c === ']') { toks.push({ t: 'brk', v: c }); i++; continue; }
    if (c === '/') {
      const mm = s.slice(i).match(/^\/[^\s<>\[\]()\/%]+/);
      toks.push({ t: 'name', v: mm[0] }); i += mm[0].length; continue;
    }
    const nm = s.slice(i).match(/^-?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (nm) { toks.push({ t: 'num', v: parseFloat(nm[0]) }); i += nm[0].length; continue; }
    const om = s.slice(i).match(/^[A-Za-z'"][\w*'\"]*/);
    if (om) { toks.push({ t: 'op', v: om[0] }); i += om[0].length; continue; }
    i++;
  }
  return toks;
}

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// process a content string with graphics state; recurse into Do forms.
function processOps(text, xoMap, ctm, depth, out) {
  if (depth > 6) return;
  const toks = tokenize(text);
  let stack = [];
  let gstack = [];
  let mtx = [...ctm];
  let path = [];
  let textMtx = null, fontSize = 10;
  const flush = (paint) => {
    if (path.length > 1) {
      const pts = [];
      for (let i = 0; i + 1 < path.length; i += 2) {
        const [x, y] = apply(mtx, path[i], path[i + 1]);
        pts.push([x, y]);
      }
      out.segs.push({ pts, paint });
    }
    path = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t === 'num' || tk.t === 'name' || tk.t === 'str' || tk.t === 'hex' || tk.t === 'brk') { stack.push(tk); continue; }
    const op = tk.v;
    const nums = [];
    while (stack.length && stack[stack.length - 1].t === 'num') nums.unshift(stack.pop().v);
    switch (op) {
      case 'q': gstack.push([...mtx]); stack.length = 0; break;
      case 'Q': if (gstack.length) mtx = gstack.pop(); stack.length = 0; break;
      case 'cm':
        if (nums.length >= 6) mtx = mul(nums.slice(0, 6), mtx);
        stack.length = 0; break;
      case 'm': if (nums.length >= 2) { if (path.length) flush('none'); path = [nums[nums.length - 2], nums[nums.length - 1]]; } stack.length = 0; break;
      case 'l': if (nums.length >= 2) { path.push(nums[nums.length - 2], nums[nums.length - 1]); } stack.length = 0; break;
      case 'c': if (nums.length >= 6) { path.push(nums[4], nums[5]); } stack.length = 0; break;
      case 'v': case 'y': if (nums.length >= 4) { path.push(nums[2], nums[3]); } stack.length = 0; break;
      case 'h': stack.length = 0; break;
      case 're':
        if (nums.length >= 4) {
          const [x, y, w, h] = nums.slice(-4);
          flush('none');
          const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(([a, b]) => apply(mtx, a, b));
          out.segs.push({ pts: p, paint: 're' });
        }
        stack.length = 0; break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n':
        if (op !== 'n') flush(op); else path = [];
        stack.length = 0; break;
      case 'BT': textMtx = [...mtx]; stack.length = 0; break;
      case 'ET': textMtx = null; stack.length = 0; break;
      case 'Tf': fontSize = nums[0] || 10; stack.length = 0; break;
      case 'Tm':
        if (nums.length >= 6 && textMtx) textMtx = mul(nums.slice(0, 6), textMtx);
        stack.length = 0; break;
      case 'Td': case 'TD':
        if (textMtx) { const [tx, ty] = nums.slice(-2); textMtx = mul([1, 0, 0, 1, tx * 1, ty * 1], textMtx); }
        stack.length = 0; break;
      case 'Tj': {
        const s = stack.pop();
        if (s && textMtx) {
          const [x, y] = apply(textMtx, 0, 0);
          out.texts.push({ text: String(s.v ?? ''), x, y, size: fontSize });
          textMtx = mul([1, 0, 0, 1, String(s.v ?? '').length * fontSize * 0.5, 0], textMtx);
        }
        stack.length = 0; break;
      }
      case 'TJ': {
        const arr = stack.pop();
        if (textMtx) { const [x, y] = apply(textMtx, 0, 0); out.texts.push({ text: '[tj]', x, y, size: fontSize }); }
        stack.length = 0; break;
      }
      case 'Do': {
        const nm = stack.pop();
        const key = nm && xoMap[String(nm.v || '').replace(/^\//, '')];
        if (key && objs.has(key)) {
          const o = objs.get(key);
          if (/\/Subtype\s*\/Form/.test(o.body)) {
            const d = decodeBody(o);
            if (d && d.data) {
              const fm = o.body.match(/\/Matrix\s*\[([^\]]*)\]/);
              const mat = fm ? fm[1].trim().split(/\s+/).map(Number) : [1, 0, 0, 1, 0, 0];
              processOps(d.data.toString('latin1'), xobjectsOf(o.body), mul(mat, mtx), depth + 1, out);
            }
          }
        }
        stack.length = 0; break;
      }
      default: stack.length = 0; break;
    }
    if (stack.length > 40) stack.length = 0;
  }
}

const pages = [];
pageKeys.forEach((pk, pi) => {
  const body = objs.get(pk).body;
  const xo = xobjectsOf(body);
  const out = { segs: [], texts: [] };
  for (const ck of contentsOf(body)) {
    const o = objs.get(ck);
    if (!o) continue;
    const d = decodeBody(o);
    if (d && d.data) processOps(d.data.toString('latin1'), xo, [1, 0, 0, 1, 0, 0], 0, out);
  }
  // page-level transform: MediaBox origin; PDF y-up. Keep raw, flip at render.
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, total = 0;
  for (const s of out.segs) for (const [x, y] of s.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y; total++;
  }
  pages.push({ page: pi + 1, segs: out.segs.length, pts: total, texts: out.texts.length, bbox: [minX, minY, maxX, maxY] });
  fs.writeFileSync(`.demo-work/vec-${pi + 1}.json`, JSON.stringify(out));
});
console.log(JSON.stringify(pages, null, 1));
