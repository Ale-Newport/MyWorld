/** Strips TypeScript types so the layout modules can be imported by node. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function resolve(specifier, context, next) {
  // `@/x` is the tsconfig alias; extensionless relative imports are
  // the TypeScript convention. Node needs both spelled out.
  let target = specifier
  if (target.startsWith('@/')) target = pathToFileURL(path.join(ROOT, 'src', target.slice(2))).href
  if ((target.startsWith('.') || target.startsWith('file:')) && !/\.[a-z]+$/.test(target)) {
    const base = target.startsWith('file:') ? target : new URL(target, context.parentURL).href
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      try { return await next(candidate, context) } catch { /* try the next shape */ }
    }
  }
  return next(target, context)
}

export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return { format: 'module', shortCircuit: true, source: outputText }
  }
  return next(url, context)
}
