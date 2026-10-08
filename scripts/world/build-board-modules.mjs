// Keep the static Three.js runtime in sync with the typed board controllers.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const files = ['world2/content/projects', 'world2/content/boards', 'world2/interactions/Projects', 'world2/interactions/Places', 'world2/interactions/screenMotion'];
for (const file of files) {
  const source = fs.readFileSync(`src/${file}.ts`, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  const output = result.replace(/from (['"])([^'"]+)\1/g, (_, quote, name) => {
    if (name.startsWith('@/')) name = path.posix.relative(path.posix.dirname(file), name.slice(2));
    if (!name.startsWith('.') && !['three'].includes(name)) name = './' + name;
    if (name.startsWith('.')) {
      if (fs.existsSync(path.resolve('src', path.dirname(file), name, 'index.ts'))) name += '/index';
      name += '.js';
    }
    return `from ${quote}${name}${quote}`;
  });
  fs.writeFileSync(`public/archipelago/preview/portfolio/${file}.js`, output);
}
