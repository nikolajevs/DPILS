#!/usr/bin/env node
/* Static checks of the modules in src/ (run by `npm run check` and in CI):
   1. every import names a module that exists and a binding that it exports;
   2. no module uses a name that is neither declared, imported nor a browser global;
   3. the modules can be evaluated in the order the browser evaluates them. ES modules are evaluated depth first in the
      order of their import statements, and a module of an import cycle may be evaluated before a module it needs. The
      check follows that order from src/main.js and reports any module whose top-level code (with the functions it
      calls, transitively) reads a const, let or class of a module that has not been evaluated yet. Functions declared
      with `function` are ready before any code runs, so they never count. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as escope from 'eslint-scope';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), SRC = path.join(ROOT, 'src'), ENTRY = path.join(SRC, 'boot.js');
const BROWSER = new Set(['window', 'AbortController', 'HTMLInputElement', 'HTMLSelectElement', 'RTCPeerConnection', 'MediaStream', 'Audio', 'document', 'navigator', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'localStorage',
  'getComputedStyle', 'HTMLElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLCanvasElement', 'Image', 'ImageData', 'OffscreenCanvas', 'Path2D',
  'devicePixelRatio', 'location', 'innerWidth', 'innerHeight', 'ResizeObserver', 'screen', 'history', 'alert', 'Event', 'KeyboardEvent', 'PointerEvent']);
const GLOBALS = new Set([...Object.getOwnPropertyNames(globalThis), ...BROWSER]);

const files = []; (function rec(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) rec(p); else if (p.endsWith('.js')) files.push(p); } })(SRC);
const M = new Map();   // file → { ast, scope, imports: Map(local → [file, name]), exports: Map(exported → local), decl: Map(local → node info) }
const problems = [];
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8'); let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module', ranges: true, locations: true }); }
  catch (e) { problems.push(`${rel(file)}: ${e.message}`); continue; }
  const sm = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' }), scope = sm.acquire(ast);
  const mod = { file, ast, sm, scope: scope.type === 'module' ? scope : scope.childScopes[0], imports: new Map(), exports: new Map(), sideImports: [] };
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      if (n.source.value === 'three' || n.source.value.startsWith('three/')) continue;   // the library (three, three/addons/…)
      const to = path.resolve(path.dirname(file), n.source.value);
      if (!n.specifiers.length) mod.sideImports.push(to);
      for (const s of n.specifiers) mod.imports.set(s.local.name, [to, s.type === 'ImportSpecifier' ? s.imported.name : '*']);
      mod.order = (mod.order || []).concat([to]);
    }
    if (n.type === 'ExportNamedDeclaration') {
      for (const s of n.specifiers) mod.exports.set(s.exported.name, s.local.name);
      if (n.declaration) for (const d of n.declaration.declarations || [n.declaration]) mod.exports.set(d.id.name, d.id.name);
    }
  }
  mod.dynamic = []; walk.simple(ast, { ImportExpression(n) { if (n.source.type === 'Literal') mod.dynamic.push(path.resolve(path.dirname(file), n.source.value)); } });
  M.set(file, mod);
}
function rel(f) { return path.relative(ROOT, f); }

// 1. imports resolve
for (const mod of M.values()) for (const [local, [to, name]] of mod.imports) {
  const target = M.get(to);
  if (!target) problems.push(`${rel(mod.file)}: imports ${local} from a missing module ${rel(to)}`);
  else if (name !== '*' && !target.exports.has(name)) problems.push(`${rel(mod.file)}: ${rel(to)} does not export ${name}`);
}
// 2. undeclared names
for (const mod of M.values()) {
  const und = new Set(); for (const r of mod.sm.globalScope.through) if (!GLOBALS.has(r.identifier.name)) und.add(r.identifier.name);
  if (und.size) problems.push(`${rel(mod.file)}: undeclared ${[...und].join(', ')}`);
}

// 3. evaluation order
const key = (file, name) => file + '#' + name;
function canon(file, name) {   // the module and local name a binding is declared under
  for (let k = 0; k < 20; k++) {
    const mod = M.get(file); if (!mod) return null;
    if (mod.imports.has(name)) { const [to, ex] = mod.imports.get(name); const t = M.get(to); if (!t || ex === '*') return null; file = to; name = t.exports.get(ex); continue; }
    return mod.scope.set.has(name) ? [file, name] : null;
  }
  return null;
}
const info = new Map();   // key → { hoisted, body }
for (const mod of M.values()) for (const v of mod.scope.variables) {
  const d = v.defs[0]; if (!d || d.type === 'ImportBinding') continue;
  const fnNode = d.type === 'FunctionName' ? d.node : (d.node.init && /Function/.test(d.node.init.type) ? d.node.init : null);
  info.set(key(mod.file, v.name), { hoisted: d.type === 'FunctionName', fn: fnNode, file: mod.file });
}
function refsWithin(mod, node) {   // bindings (canonical keys) referenced inside a node
  const out = new Set();
  for (const s of mod.sm.scopes) for (const r of s.references) {
    const id = r.identifier; if (id.range[0] < node.range[0] || id.range[1] > node.range[1]) continue;
    const res = r.resolved; if (res && res.scope !== mod.scope) continue;   // a local of some function
    const c = canon(mod.file, id.name); if (c) out.add(key(c[0], c[1]));
  }
  return out;
}
const fnCache = new Map();
function fnRefs(k) { if (!fnCache.has(k)) { const i = info.get(k); fnCache.set(k, i && i.fn ? refsWithin(M.get(i.file), i.fn.body || i.fn) : new Set()); } return fnCache.get(k); }
function evalNeeds(mod) {
  const stack = [];
  for (const n of mod.ast.body) {
    if (n.type === 'ImportDeclaration' || n.type === 'FunctionDeclaration') continue;
    const st = n.type === 'ExportNamedDeclaration' ? n.declaration : n; if (!st || st.type === 'FunctionDeclaration') continue;
    if (st.type === 'VariableDeclaration') { for (const d of st.declarations) if (d.init && !/Function/.test(d.init.type)) stack.push(...refsWithin(mod, d.init)); }
    else stack.push(...refsWithin(mod, st));
  }
  const seen = new Set();
  while (stack.length) { const k = stack.pop(); if (seen.has(k)) continue; seen.add(k); stack.push(...fnRefs(k)); }
  return seen;
}
const state = new Map(), order = [], entries = [ENTRY];
function visit(f) { if (state.has(f) || !M.has(f)) return; state.set(f, 1); for (const to of M.get(f).order || []) visit(to); state.set(f, 2); order.push(f); }
for (let k = 0; k < entries.length; k++) {   // the entry, then what it loads with import() once it has run
  const before = order.length; visit(entries[k]);
  for (const f of order.slice(before)) for (const d of M.get(f).dynamic) if (!entries.includes(d)) entries.push(d);
}
for (const f of files) if (!state.has(f)) problems.push(`${rel(f)}: not reached from src/boot.js`);
const done = new Set();
for (const f of order) {
  for (const k of evalNeeds(M.get(f))) {
    const i = info.get(k); if (!i || i.file === f || i.hoisted || done.has(i.file)) continue;
    problems.push(`${rel(f)} is evaluated before ${rel(i.file)} but needs ${k.split('#')[1]} from it while it is evaluated`);
  }
  done.add(f);
}

if (problems.length) { for (const p of problems) console.error(p); console.error(`${problems.length} problem(s)`); process.exit(1); }
console.log(`${files.length} modules checked: imports resolve, no undeclared names, evaluation order is safe`);
