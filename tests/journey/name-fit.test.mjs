import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { fitName, widthEm } = await load('src/components/journey/chapters/nameFit.ts')

test('a line is measured in capitals with the name’s tracking, accents as their base letter', () => {
  assert.ok(Math.abs(widthEm('Alejandro') - widthEm('ALEJANDRO')) < 1e-9)
  assert.ok(Math.abs(widthEm('DÍAZ') - widthEm('DIAZ')) < 1e-9)
  assert.ok(widthEm('WWW') > widthEm('III'))
  // Nine capitals of Geist 500 tracked −0.045em: about 5.6em.
  assert.ok(widthEm('ALEJANDRO') > 5.2 && widthEm('ALEJANDRO') < 6)
})

test('the first word on its own line, the rest on a second', () => {
  assert.deepEqual(fitName('Alejandro Newport').lines, ['Alejandro', 'Newport'])
  assert.deepEqual(fitName('  Ada   Lovelace ').lines, ['Ada', 'Lovelace'])
  assert.deepEqual(fitName('Cher').lines, ['Cher'])
})

test('a long rest is broken once more, at its most even space, only when that buys a clearly larger size', () => {
  const long = fitName('Alejandro Maximiliano Newport Díaz-Fernández')
  assert.deepEqual(long.lines, ['Alejandro', 'Maximiliano Newport', 'Díaz-Fernández'])
  assert.ok(long.em < widthEm('Maximiliano Newport Díaz-Fernández'))
  // Two short words after the first: no third line.
  assert.equal(fitName('Ana de Luz').lines.length, 2)
})

test('the size never relies on wrapping: em covers the widest line', () => {
  for (const name of ['Alejandro Newport', 'Alejandro Maximiliano Newport Díaz-Fernández', 'Wolfeschlegelsteinhausenbergerdorff', '王小明 Wang']) {
    const fit = fitName(name)
    for (const line of fit.lines) assert.ok(widthEm(line) <= fit.em, `${name}: ${line}`)
  }
})
