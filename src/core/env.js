import * as THREE from 'three';

const $ = id => document.getElementById(id);
const C = window.CITY;
const progress = $('progress');
if (!C || !THREE) { progress.textContent = 'Не удалось загрузить ' + (!THREE ? 'графическую библиотеку (нужен интернет).' : 'данные города (файл citydata.js должен лежать рядом со страницей).'); throw new Error('the city cannot be built'); }
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NAMES = C.names, HX = C.hx, HY = C.hy;
const TILE = 800, TTILE = 500, WL = -1.7;           // building tile, tree tile (m), water level

export { $, C, HX, HY, NAMES, TILE, TTILE, WL, progress, reduceMotion };
