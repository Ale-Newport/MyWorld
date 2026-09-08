/** Browser integration playthroughs. Teleports set up individual approaches;
 * keyboard input drives through the physical trigger. No completion methods or
 * achievement setters are invoked. Use world-race-drive for continuous laps. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://localhost:3001'
const out = process.argv[3] ?? '.qa/gameplay'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = [], results = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(`${base}/world`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'ENTER', exact: true }).click({ timeout: 120000 })
await page.waitForFunction(() => window.__world?.player?.state === 'default')
const wait = ms => page.waitForTimeout(ms)
const status = id => page.evaluate(id => {
  const g = window.__world, m = g.minigames.get(id)
  return { state: m.state, hud: g.store.getState().minigame, reached: m.reached ?? m.filled, elapsed: m.elapsed, position: {...g.player.position}, player:g.player.state, filters:[...g.inputs.filters] }
}, id)
async function position(x, z, rotation = 0, surface) {
  await page.evaluate(({ x, z, rotation, surface }) => {
    const g = window.__world
    const y = Math.max(surface ?? -Infinity, g.physics.groundAt(x, z) ?? g.terrain.colliderHeightAt(x, z)) + 2
    g.vehicle.moveTo({ x, y, z }, rotation)
    g.view.focusPoint.trackedPosition.set(x, y, z)
    g.view.snapToTarget()
  }, { x, z, rotation, surface })
  await wait(600)
}
async function approach(target, distance = 8, ms = 950) {
  const rotation = target.rotation ?? 0
  await position(target.x - Math.cos(rotation) * distance, target.z + Math.sin(rotation) * distance, rotation, target.y)
  await page.keyboard.down('KeyW'); await wait(ms); await page.keyboard.up('KeyW')
}
async function start(id) {
  await page.evaluate(id => {
    const g = window.__world
    g.minigames.cancel(); g.store.getState().setOverlay(null); g.inputs.setFilters([])
    const m = g.minigames.get(id)
    let p = m.startPosition ?? m.mouth ?? m.boardCentre ?? m.corpus ?? m.centre ?? m.stations?.[0]?.position
    if (!p || !Number.isFinite(p.x)) p = g.world.landmarks.values().find(h => h.landmark.minigame === id)?.anchor
    if (p) { g.vehicle.moveTo({ x:p.x, y:g.terrain.colliderHeightAt(p.x,p.z)+2, z:p.z }, 0); g.player.position.copy(p) }
    g.minigames.start(id)
  }, id)
  await wait(id === 'circuit' ? 3500 : id === 'orderRush' ? 1000 : 350)
}
const ids = process.env.WORLD_GAMES?.split(',') ?? ['labyrinth','chess','pipeline','retrieval','orderRush','gymCircuit','threeBody','packets']
for (const id of ids) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await start(id)
      if (id === 'chess') {
        const steps = await page.evaluate(() => {
          const m = window.__world.minigames.get('chess')
          return (m.puzzle.moves.findIndex(m => m.mate) - m.cursor + m.puzzle.moves.length) % m.puzzle.moves.length
        })
        for (let i=0;i<steps;i++) { await page.keyboard.down('ArrowRight'); await wait(160); await page.keyboard.up('ArrowRight'); await wait(150) }
        await page.keyboard.down('Enter'); await wait(160); await page.keyboard.up('Enter'); await wait(250)
      } else if (id === 'threeBody') {
        for(let i=0;i<18 && (await status(id)).state==='running';i++) { await page.keyboard.down('Enter'); await wait(160); await page.keyboard.up('Enter'); await wait(600) }
      } else if (id === 'retrieval') {
        for(let i=0;i<3;i++) {
          const p = await page.evaluate(() => { const m=window.__world.minigames.get('retrieval'); const p=m.clusters[m.rounds[m.round].answer].position; return {x:p.x,y:p.y,z:p.z,rotation:Math.atan2(p.z-m.corpus.z,m.corpus.x-p.x)} })
          await approach(p, 10, 900); await wait(950)
          console.log('retrieval-round',i,await page.evaluate(()=>{const m=window.__world.minigames.get('retrieval');return {round:m.round,phase:m.phase,state:m.state,retrieved:m.retrieved}}))
        }
        await wait(1800)
      } else if (id === 'labyrinth') {
        const path = await page.evaluate(() => {
          const m=window.__world.minigames.get('labyrinth'), points=[]
          let at=10*15+7
          for(let i=0;i<200;i++) {
            const x=at%15,z=Math.floor(at/15)
            points.push({x:m.centre.x+m.xAxis.centre[x],z:m.centre.z+m.zAxis.centre[z]})
            if(m.distance[at]===0) break
            const next=[at-1,at+1,at-15,at+15].find(n=>n>=0&&n<165&&m.distance[n]>=0&&m.distance[n]<m.distance[at])
            if(next===undefined) break
            at=next
          }
          return points
        })
        // Straight approach through each corridor cell; walls stay enabled.
        for(let i=1;i<path.length;i++) {
          const a=path[i-1], b=path[i]
          await approach({...b,rotation:Math.atan2(-(b.z-a.z),b.x-a.x)},Math.min(6,Math.hypot(b.x-a.x,b.z-a.z)),600)
        }
      } else if (id === 'gymCircuit') {
        const points=await page.evaluate(() => window.__world.minigames.get('gymCircuit').stations.map(s=>({x:s.position.x,z:s.position.z})))
        for(const p of points) await approach(p,10,800)
      } else {
        const max=id==='circuit'?38:id==='pipeline'?5:id==='packets'?8:12
        for(let i=0;i<max;i++) {
          if(!(await status(id)).state.match(/running|countdown|RACING/)) break
          const target=await page.evaluate(id=>{
            const m=window.__world.minigames.get(id)
            let t
            if(id==='circuit') t=m.gates[m.reached%m.gates.length]
            else if(id==='pipeline') t=m.stations[m.reached]
            else if(id==='orderRush') t=m.gates[m.filled%4]
            else t=m.gates[[3,2,1,0,1,2,3,4][m.reached]]
            if(!t) return null
            const p=t.centre
            return {x:t.x??p.x,z:id==='packets'?m.linkZ:p.z, y:t.y??p.y, rotation:id==='packets'?(m.reached<4?Math.PI:0):id==='pipeline'?-t.angle:(t.rotation??Math.atan2(-(t.b.x-t.a.x),-(t.b.y-t.a.y)))}
          },id)
          if(!target) break
          await approach(target, id==='pipeline'?11:6, id==='pipeline'?1200:850)
        }
      }
      const result = await status(id)
      const ok = result.state === 'finished'
      results.push({ id, attempt:attempt+1, ok, ...result })
      console.log(JSON.stringify(results.at(-1)))
      await page.screenshot({ path:`${out}/${id}-${attempt+1}.png` })
      await page.keyboard.press('Escape'); await wait(150)
      await page.evaluate(()=>window.__world.store.getState().setOverlay(null))
      await position(0,18); await wait(150)
    } catch(e) { console.log('ERROR',id,String(e)); results.push({id,attempt,error:String(e)}) }
  }
}
await writeFile(`${out}/results.json`,JSON.stringify({results,errors},null,2))
await browser.close()
process.exitCode=results.every(r=>r.ok)&&!errors.length?0:1
