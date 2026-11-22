/* The static files of the page compressed (STATIC=dist, index.mjs serveFile). The city data and the bundle are text:
   9.5 MB become 3.4 MB in brotli (citydata.js 4.3 → 1.36 MB); the models are packed geometry with pictures inside,
   18 MB → 15 MB. Nothing in front of the server compresses them (the Traefik of the VPS passes them as they are), so the
   first visit downloaded ~23 MB. Each file is compressed once per encoding and kept in memory while it stays the same
   (its size and time): brotli at quality 9 (citydata.js in ~0.6 s; quality 11 takes ~10 s for 4 % more), gzip for a
   browser without brotli. Pictures and sounds are compressed by their own formats and go as they are. On start the
   files are compressed in the background one at a time (warm), so the first visitor after a deploy gets them small. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const BR = promisify(zlib.brotliCompress), GZ = promisify(zlib.gzip);
const PACK = /\.(html|js|mjs|css|json|svg|txt|glb)$/i;
const cache = new Map();   // file + encoding → { key: its size and time, p: the promise of the bytes (null: not worth it) }

// the encoding for this file and this browser's Accept-Encoding: 'br', 'gzip' or '' (as it is)
function encodingFor(file, accept) {
  if (!PACK.test(file) || !accept) return '';
  const ok = {};
  for (const part of String(accept).split(',')) {
    const [name, ...ps] = part.trim().split(';'), q = ps.map(s => s.trim()).find(s => s.startsWith('q='));
    ok[name.trim().toLowerCase()] = q ? parseFloat(q.slice(2)) > 0 : true;
  }
  return ok.br ? 'br' : ok.gzip ? 'gzip' : '';
}
const compressible = file => PACK.test(file);

// the file compressed in this encoding; null if that is not worth it (under 1 KB, or less than 5 % smaller)
function packed(file, st, enc) {
  const id = file + '\n' + enc, key = st.size + '-' + st.mtimeMs;
  let c = cache.get(id);
  if (!c || c.key !== key) {
    const p = fs.promises.readFile(file).then(b => {
      if (b.length < 1024) return null;
      const z = enc === 'br' ? BR(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }) : GZ(b, { level: 9 });
      return z.then(out => (out.length < b.length * 0.95 ? out : null));
    }).catch(() => null);
    cache.set(id, c = { key, p });
  }
  return c.p;
}

// every compressible file of the folder in brotli, one after another (zlib works off the main thread)
async function warm(dir) {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (PACK.test(e.name)) files.push(p); } };
  try { walk(dir); } catch (e) { return; }
  const t = Date.now(); let raw = 0, out = 0;
  for (const f of files) {
    try { const st = await fs.promises.stat(f), z = await packed(f, st, 'br'); raw += st.size; out += z ? z.length : st.size; } catch (e) { /* gone meanwhile */ }
  }
  console.log(`static: ${files.length} files compressed, ${(raw / 1e6).toFixed(1)} → ${(out / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}

export { compressible, encodingFor, packed, warm };
