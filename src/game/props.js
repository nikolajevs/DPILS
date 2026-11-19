/* Готовые 3D-модели предметов (ящик патронов, граната, аптечка) — одни шаблоны на предметы на карте и на летящую гранату.
   Модели собраны tools/items.mjs со Sketchfab (CC-BY, атрибуция в models/README.md), ужаты meshopt — декодер как у солдата.
   Пока модель не приехала (или не приедет вовсе), вызывающий рисует свой примитив-фолбэк; onProps дозывает замену. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { worldSpace } from '../render/world-space.js';

const FILES = { ammo: 'models/item_ammo.glb', nade: 'models/item_nade.glb', med: 'models/item_med.glb', sight: 'models/item_sight.glb', optic: 'models/item_optic.glb' };
const templates = {};
const waiters = [];
let left = Object.keys(FILES).length;
const done = () => { if (--left <= 0) for (const w of waiters.splice(0)) w(); };

import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
  const L = new GLTFLoader();
  L.setMeshoptDecoder(MeshoptDecoder);
  for (const [kind, f] of Object.entries(FILES)) L.load(f, g => {
    // геометрия и материалы общие на все клоны: пометка, чтобы чистка предметов их не диспоузила
    g.scene.traverse(o => { if (o.isMesh) { worldSpace(o.material); o.userData.shared = true; } });
    templates[kind] = g.scene;
    done();
  }, undefined, done);
}).catch(() => { left = 1; done(); });

/* клон шаблона или null, если модель ещё/не загрузилась */
function prop(kind) { return templates[kind] ? templates[kind].clone(true) : null; }
/* когда все три попытки загрузки закончены (успехом или нет) — заменить фолбэки */
function onProps(cb) { if (left <= 0) cb(); else waiters.push(cb); }

export { prop, onProps };
