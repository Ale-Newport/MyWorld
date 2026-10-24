// Keep the static Three.js runtime in sync with the typed controllers.
//
//   node scripts/world/build-board-modules.mjs                 build every module in board-modules.json
//   node scripts/world/build-board-modules.mjs world2/signs/*  build only the named modules / folders
//   node scripts/world/build-board-modules.mjs --check         fail if a generated file is stale (used by tests)
//   node scripts/world/build-board-modules.mjs --parity world2/interactions/Career
//                                                              compare a still hand-synced public copy with what the
//                                                              generator would emit (formatting, comments and import
//                                                              specifiers ignored) and print the logical differences
//
// A module is `src/<name>.ts` -> `public/archipelago/preview/portfolio/<name>.js`.
// board-modules.json lists them one per line; an entry ending in `/*` stands for every .ts file below that folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const OUT = 'public/archipelago/preview/portfolio';
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const names = args.filter((a) => !a.startsWith('--'));

function expand(entry) {
  if (!entry.endsWith('/*')) return [entry];
  const dir = entry.slice(0, -2);
  const found = [];
  const walk = (folder) => {
    if (!fs.existsSync(path.join('src', folder))) return;
    for (const item of fs.readdirSync(path.join('src', folder), { withFileTypes: true })) {
      const next = `${folder}/${item.name}`;
      if (item.isDirectory()) walk(next);
      else if (item.name.endsWith('.ts') && !item.name.endsWith('.d.ts')) found.push(next.slice(0, -3));
    }
  };
  walk(dir);
  return found.sort();
}

const listed = JSON.parse(fs.readFileSync('scripts/world/board-modules.json', 'utf8')).flatMap(expand);
const requested = names.length ? names.flatMap(expand) : listed;
const files = [...new Set(requested)];

export function generate(file) {
  const source = fs.readFileSync(`src/${file}.ts`, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  return result.replace(/from (['"])([^'"]+)\1/g, (_, quote, name) => {
    if (name.startsWith('@/')) name = path.posix.relative(path.posix.dirname(file), name.slice(2));
    if (!name.startsWith('.') && !['three'].includes(name) && !name.startsWith('three/')) name = './' + name;
    if (name.startsWith('.')) {
      if (fs.existsSync(path.resolve('src', path.dirname(file), name, 'index.ts'))) name += '/index';
      name += '.js';
    }
    return `from ${quote}${name}${quote}`;
  });
}

/** Parsed and re-printed without comments, with import specifiers blanked: only logic remains. */
function canonical(text) {
  const sf = ts.createSourceFile('m.js', text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(sf).replace(/from (['"])[^'"]+\1/g, 'from X').replace(/import (['"])[^'"]+\1/g, 'import X');
}

if (flags.has('--parity')) {
  let differing = 0;
  for (const file of files) {
    const target = `${OUT}/${file}.js`;
    if (!fs.existsSync(target)) { console.log(`NOCOPY   ${file}`); differing++; continue; }
    const a = canonical(generate(file));
    const b = canonical(fs.readFileSync(target, 'utf8'));
    if (a === b) { console.log(`SAME     ${file}`); continue; }
    differing++;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    fs.writeFileSync(`${dir}/generated.js`, a);
    fs.writeFileSync(`${dir}/public.js`, b);
    const diff = spawnSync('diff', ['-u', `${dir}/generated.js`, `${dir}/public.js`], { encoding: 'utf8' }).stdout.split('\n');
    console.log(`DIFFER   ${file}  (${diff.length} diff lines; '-' = what the TS would generate, '+' = the public copy)`);
    console.log(diff.slice(0, 60).join('\n'));
  }
  process.exit(differing ? 1 : 0);
}

let stale = 0;
for (const file of files) {
  const target = `${OUT}/${file}.js`;
  const output = generate(file);
  if (flags.has('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) { console.log(`STALE ${file}`); stale++; }
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
}
if (flags.has('--check')) {
  if (stale) { console.error(`${stale} generated module(s) are stale: run node scripts/world/build-board-modules.mjs`); process.exit(1); }
  console.log(`${files.length} generated module(s) are current`);
}
