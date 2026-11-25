import { PB } from '../core/util.js';

/* ---------- colours ---------- */
const AREA_HEX = { 0: '#4b6670', 1: '#3f5636', 2: '#536b3e', 3: '#5d7042', 4: '#566c3e', 5: '#586a46', 6: '#b3a37a', 7: '#827f55', 8: '#6c7254', 9: '#7d7a72', 10: '#4f7a3f', 11: '#62724a', 12: '#8e877c', 13: '#a08d68' };
const AREA_ORDER = [8, 7, 9, 11, 3, 2, 1, 4, 5, 6, 12, 13, 10, 0];
// line classes: width (m), colour, paint group (0 water, 1 paving, 2 dirt, 3 ballast, 4 asphalt)
const LINE = {
  0: [11, '#47484a', 4], 1: [9, '#4a4b4d', 4], 2: [7.5, '#4d4e50', 4], 3: [6, '#525355', 4], 4: [3.6, '#58595a', 4],
  5: [6, '#968e82', 1], 6: [2, '#9a9386', 1], 15: [2, '#8d877c', 1], 7: [2.8, '#857659', 2],
  8: [3.8, '#8a847c', 3], 9: [2.6, '#6a645c', 3], 10: [1.8, '#4b6670', 0], 11: [7, '#4b6670', 0]
};
const WALLPAL = {
  0: PB(['#eadcc0', '#e8d2a2', '#efe7d8', '#dac6ae', '#e6cbb6', '#d0d6c5', '#d6dfe2', '#f0dccb', '#cdb48a', '#e2c79a']),
  1: PB(['#b05a43', '#a54f3a', '#b9654a', '#9b4a37', '#c06f52']),
  2: PB(['#e9e6de', '#dddbd3', '#d2cfc6', '#ece7dc', '#d8d2c4']),
  3: PB(['#dcd8cf', '#d2cec4', '#c8c4ba', '#e0d9c9']),
  4: PB(['#f2f0ea', '#ece4cf', '#dde3e8', '#c9cdd1', '#f3e2b0', '#eac8a5', '#c4d4de', '#a9b1b8', '#e8d3c8']),
  5: PB(['#8b6a48', '#97784f', '#77876a', '#869498', '#d0b273', '#a99a86', '#6b8c93', '#ac6b49', '#c3bcab', '#7f9c78']),
  6: PB(['#c4c8ca', '#b3b6b2', '#cfcdc3', '#a8b2ba', '#c2b39c']),
  7: PB(['#c0b9ad', '#b3aca0', '#cbc2b3', '#a7a094', '#c4ae95'])
};
const PLINTH = PB(['#77716a', '#837b71', '#655f59', '#8c8378', '#6f6a62']);
const ROOFPAL = {
  0: PB(['#9c9a94', '#8f8d88']), 1: PB(['#9a9a92', '#a3a29a', '#8b8d87', '#b0aea4', '#8f9282']), 2: PB(['#5f7a5f', '#843e30', '#6d7175', '#3f4b57', '#8f5d3e', '#a1a6a8', '#4f6b4c']),
  3: PB(['#a8553a', '#b5623f', '#94472f']), 4: PB(['#5e3d34', '#4d4c4c', '#743d30', '#3e4a3e']), 5: PB(['#5a5a58', '#636260', '#4e4f50', '#6c6a66']), 6: PB(['#dce9e8']), 7: PB(['#7a6d5a'])
};
const ROUGH = [235, 240, 130, 225, 240, 215, 20, 245];
const BAY = [3.6, 3.4, 3.1, 3.2, 3.4, 3.0, 6.0, 4.0];
const PLINTH_H = [0.9, 0.8, 0.6, 0.7, 0.45, 0.5, 0.3, 0.15];

export { AREA_HEX, AREA_ORDER, BAY, LINE, PLINTH, PLINTH_H, ROOFPAL, ROUGH, WALLPAL };
