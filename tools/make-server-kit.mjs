/* Builds the "server kit": one zip a bare Windows or Linux machine unpacks and double-clicks to host its own
   Daugavpils server — a portable Node.js, the game server, the built page (dist) and the launcher that asks for the
   server name. Output: kit-out/dpils-server-windows.zip and kit-out/dpils-server-linux.zip.
     node tools/make-server-kit.mjs [--win-only] [--linux-only] [--skip-build] [--node v22.x.y]
   Publish (once, then upload --clobber on updates):
     gh release create server-kit kit-out/dpils-server-windows.zip kit-out/dpils-server-linux.zip --title "..." --notes "..." */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'kit-out'), TMP = path.join(OUT, 'tmp');
const arg = process.argv.slice(2);
const has = f => arg.includes(f);
const val = f => { const i = arg.indexOf(f); return i >= 0 ? arg[i + 1] : ''; };
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd: cwd || ROOT, stdio: 'inherit', shell: false }); if (r.status !== 0) { console.error(`\nКоманда упала: ${cmd} ${args.join(' ')}`); process.exit(1); } };
const mb = f => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';

/* the page must be fresh: the kit serves it from dist */
if (!has('--skip-build')) { console.log('Собираю страницу (vite build)…'); run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']); }
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('Нет dist/index.html — сначала npm run build.'); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'ws', 'package.json'))) { console.error('Нет node_modules/ws — сначала npm install.'); process.exit(1); }

/* Node 22 LTS, portable: node.exe alone is enough, npm is not needed (ws is pure JS and goes into the kit) */
let ver = val('--node');
if (!ver) {
  console.log('Ищу свежий Node 22 LTS…');
  const list = await (await fetch('https://nodejs.org/dist/index.json')).json();
  ver = (list.find(x => x.version.startsWith('v22.')) || {}).version;
  if (!ver) { console.error('Не нашёл Node 22 в index.json.'); process.exit(1); }
}
console.log('Node:', ver);
fs.mkdirSync(TMP, { recursive: true });
async function download(url, file) {
  if (fs.existsSync(file)) { console.log('Уже скачано:', path.basename(file)); return; }
  console.log('Скачиваю', url);
  const r = await fetch(url); if (!r.ok) { console.error('HTTP', r.status, url); process.exit(1); }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/* everything the server and the page need, besides Node itself */
function fillKit(dir) {
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'server'))) if (f.endsWith('.mjs')) fs.copyFileSync(path.join(ROOT, 'server', f), path.join(dir, 'server', f));
  for (const f of ['citydata.js', 'terrain.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));   // world.mjs reads them from the kit root
  fs.cpSync(path.join(ROOT, 'node_modules', 'ws'), path.join(dir, 'node_modules', 'ws'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), { recursive: true });
  for (const f of ['launcher.mjs', 'README.txt']) fs.copyFileSync(path.join(ROOT, 'tools', 'server-kit', f), path.join(dir, f));
}
function zip(dir, out) {
  if (fs.existsSync(out)) fs.rmSync(out);
  if (process.platform === 'win32') {
    const r = spawnSync('tar', ['-a', '-cf', out, '-C', dir, '.'], { stdio: 'inherit' });   // bsdtar: -a picks zip by the extension
    if (r.status !== 0) run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}\\*' -DestinationPath '${out}' -Force`]);
  } else run('zip', ['-rq', out, '.'], dir);
  console.log('Готово:', path.relative(ROOT, out), mb(out));
}

if (!has('--linux-only')) {
  const z = path.join(TMP, `node-${ver}-win-x64.zip`);
  await download(`https://nodejs.org/dist/${ver}/node-${ver}-win-x64.zip`, z);
  const ex = path.join(TMP, 'win'); fs.mkdirSync(ex, { recursive: true });
  run('tar', ['-xf', z, '-C', ex]);
  const nd = path.join(ex, `node-${ver}-win-x64`), dir = path.join(OUT, 'kit-win');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(nd, 'node.exe'), path.join(dir, 'node.exe'));
  fs.copyFileSync(path.join(nd, 'LICENSE'), path.join(dir, 'node-LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'server-kit', 'start.cmd'), path.join(dir, 'start.cmd'));
  fs.writeFileSync(path.join(dir, 'start.cmd'), fs.readFileSync(path.join(dir, 'start.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'));   // cmd wants CRLF whatever the checkout did
  fillKit(dir);
  zip(dir, path.join(OUT, 'dpils-server-windows.zip'));
}
if (!has('--win-only')) {
  const z = path.join(TMP, `node-${ver}-linux-x64.tar.gz`);
  await download(`https://nodejs.org/dist/${ver}/node-${ver}-linux-x64.tar.gz`, z);
  const ex = path.join(TMP, 'linux'); fs.mkdirSync(ex, { recursive: true });
  run('tar', ['-xf', z, '-C', ex, `node-${ver}-linux-x64/bin/node`, `node-${ver}-linux-x64/LICENSE`]);   // only these two: bin/npm and friends are symlinks Windows cannot create
  const nd = path.join(ex, `node-${ver}-linux-x64`), dir = path.join(OUT, 'kit-linux');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(nd, 'bin', 'node'), path.join(dir, 'node')); fs.chmodSync(path.join(dir, 'node'), 0o755);
  fs.copyFileSync(path.join(nd, 'LICENSE'), path.join(dir, 'node-LICENSE.txt'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'server-kit', 'start.sh'), path.join(dir, 'start.sh')); fs.chmodSync(path.join(dir, 'start.sh'), 0o755);
  fs.writeFileSync(path.join(dir, 'start.sh'), fs.readFileSync(path.join(dir, 'start.sh'), 'utf8').replace(/\r\n/g, '\n'));   // sh wants LF whatever the checkout did
  fillKit(dir);
  zip(dir, path.join(OUT, 'dpils-server-linux.zip'));
}
console.log('\nВыложить: gh release create server-kit kit-out/dpils-server-windows.zip kit-out/dpils-server-linux.zip');
console.log('Обновить: gh release upload server-kit kit-out/*.zip --clobber');
