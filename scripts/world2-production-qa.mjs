/** Checks the built route through its public UI, without development hooks. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base=process.argv.find(a=>a.startsWith('http'))??'http://localhost:3001'
await mkdir('.qa/world2',{recursive:true})
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle']})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[]
const check=(name,pass)=>{checks.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name)}
page.on('pageerror',e=>errors.push(String(e)))
try{
  for(const route of ['/','/world','/world2']){const response=await page.goto(base+route);check('production '+route+' returns 200',response.status()===200)}
  const start=page.getByRole('button',{name:'Start driving'})
  await start.waitFor({timeout:120000});await start.click();await page.waitForTimeout(1000)
  check('production has no development engine handle',await page.evaluate(()=>!window.__world2))
  check('production hides level debug panel',await page.getByText(/Level validation/).count()===0)
  check('production mounts one World2 canvas',await page.locator('[data-world2-ready=true] canvas').count()===1)
  await page.keyboard.down('w');await page.waitForTimeout(550)
  check('production keyboard driving updates speed',Number(await page.locator('[class*="speed"] strong').textContent())>0)
  await page.keyboard.up('w');await page.keyboard.press('m')
  check('production source map opens',await page.getByRole('dialog',{name:'Island map'}).isVisible())
  await page.keyboard.press('Escape');await page.screenshot({path:'.qa/world2/production.png'})
  await page.getByRole('link',{name:'Back to portfolio'}).click();await page.waitForURL(base+'/')
  check('production navigation removes World2 mount',await page.locator('[data-world2-ready]').count()===0)
  check('no production browser errors',errors.length===0)
}catch(e){errors.push(String(e));check('production harness completed',false)}
await writeFile('.qa/world2/production-report.json',JSON.stringify({checks,errors},null,2))
await browser.close();process.exitCode=checks.some(c=>!c.pass)?1:0
