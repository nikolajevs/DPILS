/* DPILS server kit launcher. Asks for the server settings in the terminal (Russian, the players are Russian-speaking),
   saves them to config.json beside this file and starts server/index.mjs with the built page (STATIC=dist), so the city
   and its server live on one address and friends only need a browser. Runs on the Node bundled in the kit: nothing to
   install. Flags for automation: --name X --port N --mode team|ffa --bots N --arena X --yes (no questions) --no-open. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CFG = path.join(ROOT, 'config.json');
const ARENAS = ['center', 'fortress', 'station', 'park', 'church', 'pond', 'speedway', 'culture', 'griva'];
const DEF = { name: 'Мой Даугавпилс', port: 8787, mode: 'team', bots: 4, arena: 'center' };

if (+process.versions.node.split('.')[0] < 20) { console.error('Нужен Node.js 20 или новее (в комплекте идёт 22).'); process.exit(1); }

/* flags: --key value or --key=value */
const arg = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq > 0) arg[a.slice(2, eq)] = a.slice(eq + 1);
  else if (a === '--yes' || a === '--no-open') arg[a.slice(2)] = true;
  else arg[a.slice(2)] = process.argv[++i] || '';
}

let cfg = { ...DEF };
try { cfg = { ...DEF, ...JSON.parse(fs.readFileSync(CFG, 'utf8')) }; } catch (e) {}
for (const k of ['name', 'port', 'mode', 'bots', 'arena']) if (arg[k] != null && arg[k] !== true) cfg[k] = arg[k];
cfg.port = Math.min(65535, Math.max(1, +cfg.port || DEF.port));
cfg.bots = Math.min(15, Math.max(0, Math.round(+cfg.bots || 0)));
cfg.mode = cfg.mode === 'ffa' ? 'ffa' : 'team';
if (!ARENAS.includes(cfg.arena)) cfg.arena = DEF.arena;
cfg.name = String(cfg.name || DEF.name).slice(0, 40);

const ask = (() => {   // a line queue: answers may arrive faster than the questions (piped input, a paste)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = []; let waiter = null, closed = false;
  rl.on('line', l => { if (waiter) { const w = waiter; waiter = null; w(l.trim()); } else lines.push(l.trim()); });
  rl.on('close', () => { closed = true; if (waiter) { const w = waiter; waiter = null; w(''); } });
  return q => new Promise(res => { process.stdout.write(q); if (lines.length) res(lines.shift()); else if (closed) res(''); else waiter = res; });
})();
async function questions() {
  console.log('=== Свой сервер «Даугавпилс 3D» ===');
  console.log('Enter — оставить значение в скобках.\n');
  cfg.name = (await ask(`Название сервера [${cfg.name}]: `)) || cfg.name;
  const p = await ask(`Порт [${cfg.port}]: `); if (p) cfg.port = Math.min(65535, Math.max(1, +p || cfg.port));
  const m = await ask(`Режим: 1 — команды, 2 — каждый сам за себя [${cfg.mode === 'ffa' ? 2 : 1}]: `);
  if (m === '2') cfg.mode = 'ffa'; else if (m === '1') cfg.mode = 'team';
  const b = await ask(`Сколько ботов (0–15) [${cfg.bots}]: `); if (b !== '') cfg.bots = Math.min(15, Math.max(0, Math.round(+b || 0)));
  const a = await ask(`Арена (${ARENAS.join(', ')}) [${cfg.arena}]: `); if (a && ARENAS.includes(a)) cfg.arena = a;
  cfg.name = String(cfg.name).slice(0, 40);
}
if (!arg.yes) await questions();
fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');

/* the address friends on the same network type into the browser */
function lanIp() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) return n.address;
  return '127.0.0.1';
}
const ip = lanIp(), url = `http://localhost:${cfg.port}`, net = `http://${ip}:${cfg.port}`;
console.log(`\nСервер «${cfg.name}» запускается…`);
console.log(`  Вы играете:      ${url}`);
console.log(`  Друзья в сети:   ${net}   (открывают в браузере, сервер уже в списке)`);
console.log('  Остановить:      Ctrl+C или закройте это окно.\n');
if (process.platform === 'win32') console.log('Если Windows спросит про доступ к сети — нажмите «Разрешить» (частные сети).\n');

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, PORT: String(cfg.port), SERVER_NAME: cfg.name, MODE: cfg.mode, BOTS: String(cfg.bots), ARENA: cfg.arena, STATIC: path.join(ROOT, 'dist') }
});
child.on('exit', code => { console.log('\nСервер остановлен.'); process.exit(code == null ? 0 : code); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

/* open the page once the server answers (the world takes a moment to load) */
if (!arg['no-open']) {
  const t0 = Date.now();
  (async () => {
    while (Date.now() - t0 < 20000) {
      try { const r = await fetch(`http://127.0.0.1:${cfg.port}/health`); if (r.ok) break; } catch (e) {}
      await new Promise(r => setTimeout(r, 400));
    }
    try {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      else if (process.platform === 'linux') spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {}
  })();
}
