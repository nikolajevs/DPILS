import { createGame } from '../../server/game.mjs';
import { makePhysics } from '../../server/physics.mjs';
import { ARENAS } from '../../server/arenas.mjs';
import { buildingAt } from '../world/data.js';
import { walkLift } from '../world/terrain.js';

/* ---------- the game against bots, with no server ----------
   The rules of the game are the ones of the server (server/game.mjs: the same code runs here, in the page): the page
   gets a connection that looks like a WebSocket but leads to a game in the page itself, with the bots in it. The city for
   the game is the one already built: its houses and its ground. */
// the game stands on the same ground as the walk: walkLift carries the sidewalks, the platforms and steps, the
// fortress ramparts, the speedway and the bridge decks (prev = the query height less an eye, so a deck is taken only
// by one already on it). Bullets, grenades and bots therefore meet the city the body stands in, not the raw lidar grid.
const ground = (x, z, y = null) => walkLift(x, z, y == null ? null : y - 1.7);
const world = { ...makePhysics(buildingAt, ground), buildingAt, ground };
// opts: { bots, level: easy | normal | hard, mode: team | ffa, arena: center | fortress | station | '' }
class LocalSocket {
  constructor(opts) {
    this.readyState = 0; this.closed = false;
    this.game = createGame({ world, mode: opts.mode, arena: ARENAS[opts.arena] || null, level: opts.level, name: 'Тренировка с ботами', maxPlayers: 64 });
    this.h = this.game.attach({ send: s => this.deliver(s), close: () => this.close() });
    for (let i = 0; i < Math.max(0, Math.min(63, opts.bots | 0)); i++) this.game.addBot(opts.level);   // 63 bots + you = the 64 places
    setTimeout(() => { if (this.closed) return; this.readyState = 1; if (this.onopen) this.onopen(); }, 0);
  }
  deliver(s) { setTimeout(() => { if (!this.closed && this.onmessage) this.onmessage({ data: s }); }, 0); }   // later, as a network would
  send(s) { if (!this.closed) this.h.message(s); }
  close() { if (this.closed) return; this.closed = true; this.readyState = 3; this.h.close(); this.game.stop(); if (this.onclose) this.onclose(); }
}
export const openLocal = opts => new LocalSocket(opts);
