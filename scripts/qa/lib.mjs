/* Shared helpers for the Playwright checks in scripts/qa. Headless
   Chromium is launched on the real GPU (ANGLE/Metal on macOS) because
   SwiftShader is too slow to run the world at a meaningful frame rate. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

export const BASE = process.env.QA_BASE ?? 'http://localhost:3210'
export const OUT = process.env.QA_OUT ?? path.resolve('.qa/runs')

export async function launch(options = {}) {
  const args = process.env.QA_SWIFTSHADER ? ['--enable-unsafe-swiftshader', '--use-gl=angle'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  return chromium.launch({ headless: true, args, ...options })
}

export function out(name) {
  fs.mkdirSync(OUT, { recursive: true })
  return path.join(OUT, name)
}

/** Collects console errors and uncaught exceptions so a check can fail on them. */
export function watch(page, label = '') {
  const errors = []
  page.on('pageerror', (e) => errors.push(`${label}pageerror: ${String(e).slice(0, 400)}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}console: ${m.text().slice(0, 400)}`) })
  return errors
}

/** The runtime marks <body data-ready> once its first prepared frame is on screen. */
export async function openPlayer(page, query = '') {
  await page.goto(`${BASE}/archipelago/preview/index.html${query}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 180_000 })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function assert(condition, message, results) {
  results.push({ ok: !!condition, message })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`)
  return !!condition
}

export function finish(results) {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
}
