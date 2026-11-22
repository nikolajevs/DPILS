/* The event settings of the admin panel (the «Ивенты» tab, admin.mjs / admin.html). The city runs three events:
   the «Царь горы» race to Church Hill (HOLY, combat.mjs), the cargo drop (CARGO, combat.mjs) and the «Шторм» finale
   of the match (MATCH / STORM, storm.mjs). Their rules are data, and this store lets the admin tune that data live:
   the saved overrides are written straight into the HOLY / CARGO / MATCH / STORM objects — the game, the bots and
   the messages to the page read them from there, so a change takes effect at once, without a restart. The page gets
   the changed capture rules and buffs in the 'holy' message (holyPublic, game.mjs); the storm settings apply to the
   next match — the running one keeps its schedule (it is clock-driven and survives a restart).
   Each event also has an enabled flag: off pauses its automatic schedule (a running event finishes; the admin can
   start and stop it by hand). The settings live in a small json file (default server/data/events.json, EVENTS=off —
   no file, the changes stay in memory). Values are clamped to sane ranges, an unknown key is refused. */
import fs from 'node:fs';
import path from 'node:path';
import { HOLY, CARGO } from './combat.mjs';
import { MATCH, STORM } from './storm.mjs';

export const EVENT_KINDS = ['holy', 'cargo', 'storm'];
// the defaults: the rules as written in combat.mjs and storm.mjs, captured before any override
const DEF = {
  holy: { firstMs: HOLY.firstMs, gapMs: HOLY.gapMs, durMs: HOLY.durMs, warnMs: HOLY.warnMs, capMs: HOLY.capMs, capR: HOLY.capR, holdMs: HOLY.holdMs, prizeScore: HOLY.prizeScore, prizeKills: HOLY.prizeKills, buffs: { ...HOLY.buffs } },
  cargo: { firstMs: CARGO.firstMs, gapMs: CARGO.gapMs, groundMs: CARGO.groundMs, markMs: CARGO.markMs, alt: CARGO.alt, speed: CARGO.speed, pickR: CARGO.pickR, beaconR: CARGO.beaconR, loot: Object.fromEntries(CARGO.loot) },
  storm: { share: MATCH.stormShare, suddenMs: STORM.suddenMs, suddenDps: STORM.suddenDps, rEnd: STORM.rEnd },
};
const DEF_BUFFNAME = { ...HOLY.buffName };
// the sane ranges of every tunable value (nested keys as 'buffs.dmg'); the panel's inputs carry the same bounds
const RANGE = {
  holy: { firstMs: [10000, 21600000], gapMs: [30000, 86400000], durMs: [60000, 21600000], warnMs: [5000, 600000], capMs: [1000, 120000], capR: [3, 50], holdMs: [10000, 1800000], prizeScore: [0, 100], prizeKills: [0, 100], 'buffs.dmg': [1, 3], 'buffs.regen': [0, 20], 'buffs.speed': [1, 2], 'buffs.reload': [0.3, 1], 'buffs.rate': [0.3, 1] },
  cargo: { firstMs: [10000, 21600000], gapMs: [30000, 86400000], groundMs: [10000, 21600000], markMs: [0, 1800000], alt: [20, 500], speed: [1, 30], pickR: [1, 10], beaconR: [1, 30], 'loot.med': [0, 9], 'loot.nade': [0, 9], 'loot.smoke': [0, 9], 'loot.napalm': [0, 9], 'loot.optic': [0, 9] },
  storm: { share: [0.05, 0.5], suddenMs: [0, 300000], suddenDps: [1, 100], rEnd: [5, 100] },
};
const clone = o => JSON.parse(JSON.stringify(o));
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
function set(o, k, v) { const ps = k.split('.'); let t = o; for (let i = 0; i < ps.length - 1; i++) t = t[ps[i]] = t[ps[i]] || {}; t[ps[ps.length - 1]] = v; }
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const pct = x => Math.round(x * 100);

// the buff labels follow the values: the chat, the page chips and the admin panel all read HOLY.buffName
function buffName(b) {
  return {
    dmg: 'Урон +' + pct(b.dmg - 1) + '%',
    regen: 'Реген +' + (Math.round(b.regen * 10) / 10) + ' HP/с',
    speed: 'Скорость +' + pct(b.speed - 1) + '%',
    reload: 'Перезарядка −' + pct(1 - b.reload) + '% · темп +' + pct(1 - b.rate) + '%',
  };
}
// write one event's settings into the rules the game reads
function apply(kind, cfg) {
  if (kind === 'holy') {
    for (const k of ['firstMs', 'gapMs', 'durMs', 'warnMs', 'capMs', 'capR', 'holdMs', 'prizeScore', 'prizeKills']) HOLY[k] = cfg[k];
    HOLY.buffs = { ...cfg.buffs };
    HOLY.buffName = buffName(cfg.buffs);
  } else if (kind === 'cargo') {
    for (const k of ['firstMs', 'gapMs', 'groundMs', 'markMs', 'alt', 'speed', 'pickR', 'beaconR']) CARGO[k] = cfg[k];
    CARGO.loot = Object.entries(cfg.loot).filter(([, n]) => n > 0);
  } else if (kind === 'storm') {
    MATCH.stormShare = cfg.share; STORM.suddenMs = cfg.suddenMs; STORM.suddenDps = cfg.suddenDps; STORM.rEnd = cfg.rEnd;
  }
}

export function createEvents({ file = null } = {}) {
  const st = {};
  for (const k of EVENT_KINDS) st[k] = { enabled: true, cfg: clone(DEF[k]) };
  function save() {
    if (!file) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st)); fs.renameSync(tmp, file); }
    catch (e) { console.error('events: не сохранились настройки', e.message); }
  }
  // a patch of settings: the known numeric keys, clamped; anything else is refused
  function set(kind, patch) {
    if (!st[kind]) return { error: 'bad-cfg' };
    if (!patch || typeof patch !== 'object') return { error: 'bad-cfg' };
    const flat = {};
    (function walk(o, pre) { for (const [k, v] of Object.entries(o)) { const key = pre ? pre + '.' + k : k; if (v && typeof v === 'object') walk(v, key); else flat[key] = v; } })(patch, '');
    for (const [key, v] of Object.entries(flat)) {
      const r = RANGE[kind][key];
      if (!r || typeof v !== 'number' || !Number.isFinite(v)) return { error: 'bad-cfg' };
      set(st[kind].cfg, key, clamp(key === 'capR' || key === 'prizeScore' || key === 'prizeKills' || key.startsWith('loot.') || key === 'rEnd' ? Math.round(v) : v, r));
    }
    apply(kind, st[kind].cfg); save();
    return { ok: true };
  }
  function reset(kind) {
    for (const k of kind === 'all' ? EVENT_KINDS : [kind]) {
      if (!st[k]) continue;
      st[k] = { enabled: true, cfg: clone(DEF[k]) };
      apply(k, st[k].cfg);
    }
    if (kind === 'all' || kind === 'holy') HOLY.buffName = { ...DEF_BUFFNAME };
    save();
    return { ok: true };
  }
  // the saved file: the enabled flags and the known keys of the settings (a stale or foreign value is dropped)
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of EVENT_KINDS) {
        const s = saved && saved[k]; if (!s) continue;
        if (typeof s.enabled === 'boolean') st[k].enabled = s.enabled;
        if (s.cfg && typeof s.cfg === 'object') {
          const flat = {};
          (function walk(o, pre) { for (const [key, v] of Object.entries(o)) { const kk = pre ? pre + '.' + key : key; if (v && typeof v === 'object') walk(v, kk); else flat[kk] = v; } })(s.cfg, '');
          for (const [key, v] of Object.entries(flat)) { const r = RANGE[k][key]; if (r && typeof v === 'number' && Number.isFinite(v)) set(st[k].cfg, key, clamp(v, r)); }
        }
      }
    } catch (e) { /* no file yet, or a broken one: the defaults stand */ }
  }
  for (const k of EVENT_KINDS) apply(k, st[k].cfg);
  return {
    enabled: kind => (st[kind] ? st[kind].enabled : true),
    setEnabled(kind, on) { if (!st[kind]) return { error: 'bad-cfg' }; st[kind].enabled = !!on; save(); return { ok: true }; },
    set, reset, save,
    view: () => Object.fromEntries(EVENT_KINDS.map(k => [k, { enabled: st[k].enabled, cfg: clone(st[k].cfg), defaults: clone(DEF[k]) }])),
  };
}
