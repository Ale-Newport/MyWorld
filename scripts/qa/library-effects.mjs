/* Every effect added with the animation library, in the library's own preview:
     it renders something;
     it moves on its own when it is meant to (continuous effects);
     one of its controls, changed through the UI, visibly changes it;
     with Reduced motion on it holds a still frame.
   node scripts/qa/library-effects.mjs [effect-id …] */
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn } from './admin-session.mjs'

const EFFECTS = [
  { id: 'text.typewriter', label: 'Text', type: 'text', value: 'QA typed line' },
  { id: 'text.split-flap', label: 'Text (A–Z, 0–9, : . - /)', type: 'text', value: 'QA BOARD' },
  { id: 'text.marquee', label: 'Phrases (comma separated)', type: 'text', value: 'Alpha, Beta', continuous: true },
  { id: 'text.highlight', label: 'Words to mark (comma separated)', type: 'text', value: 'parts' },
  { id: 'data.bars', label: 'Data (Label: value; …)', type: 'text', value: 'Alpha: 10; Beta: 90' },
  { id: 'data.gauge', label: 'Value (0–100) value', type: 'number', value: '30' },
  { id: 'data.sparkline', label: 'Values (comma separated)', type: 'text', value: '1, 9, 2, 8' },
  { id: 'shape.orbits', label: 'Rings value', type: 'number', value: '7', continuous: true, still: true },
  { id: 'shape.blob', label: 'Fill', type: 'select', value: 'outline', continuous: true },
  { id: 'shape.line-draw', label: 'Shape', type: 'select', value: 'spiral' },
  { id: 'particles.flow-field', label: 'Colour', type: 'select', value: 'accent', continuous: true, still: true },
  { id: 'particles.constellation', label: 'Link distance value', type: 'number', value: '240', continuous: true, still: true },
  { id: 'background.gradient-mesh', label: 'Colour 2', type: 'text', value: '#2244ff', continuous: true, still: true },
  { id: 'background.dot-ripple', label: 'Spacing value', type: 'number', value: '40', still: true },
  { id: 'interaction.tilt-card', label: 'Title', type: 'text', value: 'QA card' },
  { id: 'scroll.parallax-layers', label: 'Layers value', type: 'number', value: '3' },
  { id: 'transition.wipe', label: 'Text', type: 'text', value: 'QA wipe' },
]
const only = process.argv.slice(2)
const results = []
const browser = await launch()
const { page } = await signIn(browser, { viewport: { width: 1500, height: 1000 } })
const errors = watch(page)
await page.goto(`${BASE}/admin/library`, { waitUntil: 'domcontentloaded' })
await page.locator('.lib-card').first().waitFor({ timeout: 60000 })

/** A fingerprint of what the preview shows: canvas pixels, else markup and live transforms. */
const signature = (id) => page.evaluate((id) => {
  const box = document.querySelector(`[data-lib-preview="${id}"]`)
  if (!box) return 'missing'
  const canvas = box.querySelector('canvas')
  if (canvas) {
    const c = document.createElement('canvas'); c.width = 48; c.height = 32
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, 48, 32)
    const d = x.getImageData(0, 0, 48, 32).data
    let h = 0, ink = 0
    for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + d[i + 3]) >>> 0; if (d[i + 3] > 8) ink++ }
    return `canvas:${ink}:${h}`
  }
  const live = [...box.querySelectorAll('*')].map((el) => { const cs = getComputedStyle(el); return `${cs.transform}|${cs.opacity}|${el.getAttribute('d') ?? ''}|${el.getAttribute('transform') ?? ''}|${cs.backgroundSize}|${cs.strokeDashoffset}` }).join(';')
  return `dom:${box.textContent.length}:${box.innerHTML.length}:${live.length}:${[...live].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)}`
}, id)
const painted = (id) => page.evaluate((id) => {
  const box = document.querySelector(`[data-lib-preview="${id}"]`)
  const canvas = box?.querySelector('canvas')
  if (canvas) { const x = canvas.getContext('2d'); const d = x.getImageData(0, 0, canvas.width, canvas.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++; return n }
  return (box?.textContent.trim().length ?? 0) + (box?.querySelectorAll('path, circle, rect, li, span').length ?? 0)
}, id)

for (const e of EFFECTS.filter((x) => !only.length || only.includes(x.id))) {
  await page.locator('.lib-card', { has: page.locator(`.a-mono:text-is("${e.id}")`) }).locator('.lib-hit').click()
  await page.locator(`[data-lib-preview="${e.id}"]`).waitFor({ timeout: 20000 })
  await sleep(1800)
  assert((await painted(e.id)) > 0, `${e.id}: renders in the preview`, results)
  if (e.continuous) {
    const a = await signature(e.id); await sleep(700); const b = await signature(e.id)
    assert(a !== b, `${e.id}: animates on its own`, results)
  }
  // Reduced motion first for canvases, so a control's effect is measured on a still frame.
  if (e.still) { await page.getByRole('button', { name: 'Reduced motion' }).click(); await sleep(900) }
  const before = await signature(e.id)
  const field = page.locator('.lib-detail').getByLabel(e.label, { exact: true })
  if (e.type === 'select') await field.selectOption(e.value)
  else { await field.fill(e.value) }
  await sleep(e.id === 'text.split-flap' ? 2600 : 1600)
  const after = await signature(e.id)
  assert(before !== after, `${e.id}: changing “${e.label.replace(/ value$/, '')}” changes the effect`, results)
  if (!e.still) { await page.getByRole('button', { name: 'Reduced motion' }).click(); await sleep(900) }
  const s1 = await signature(e.id); await sleep(800); const s2 = await signature(e.id)
  assert(s1 === s2 && (await painted(e.id)) > 0, `${e.id}: reduced motion holds a still frame`, results)
  await page.locator(`[data-lib-preview="${e.id}"]`).screenshot({ path: out(`library/${e.id}.png`) }).catch(() => {})
  await page.getByRole('button', { name: 'Reduced motion' }).click()
}
assert(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`, results)
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
