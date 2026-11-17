import { createGame } from '../../server/game.mjs';
import { makePhysics } from '../../server/physics.mjs';
import { ARENAS } from '../../server/arenas.mjs';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';

/* ---------- the game against bots, with no server ----------
   The rules of the game are the ones of the server (server/game.mjs: the same code runs here, in the page): the page
   gets a connection that looks like a WebSocket but leads to a game in the page itself, with the bots in it. The city for
   the game is the one already built: its houses and its ground. */
const world = { ...makePhysics(buildingAt, terrainH), buildingAt, ground: terrainH };
// opts: { bots, level: easy | normal | hard, mode: team | ffa, arena: center | fortress | station | '' }
class LocalSocket {
  constructor(opts) {
    this.readyState = 0; this.closed = false;
    this.game = createGame({ world, mode: opts.mode, arena: ARENAS[opts.arena] || null, level: opts.level, name: 'Тренировка с ботами', maxPlayers: 16 });
    this.h = this.game.attach({ send: s => this.deliver(s), close: () => this.close() });
    for (let i = 0; i < Math.max(0, Math.min(12, opts.bots | 0)); i++) this.game.addBot(opts.level);
    setTimeout(() => { if (this.closed) return; this.readyState = 1; if (this.onopen) this.onopen(); }, 0);
  }
  deliver(s) { setTimeout(() => { if (!this.closed && this.onmessage) this.onmessage({ data: s }); }, 0); }   // later, as a network would
  send(s) { if (!this.closed) this.h.message(s); }
  close() { if (this.closed) return; this.closed = true; this.readyState = 3; this.h.close(); this.game.stop(); if (this.onclose) this.onclose(); }
}
export const openLocal = opts => new LocalSocket(opts);
