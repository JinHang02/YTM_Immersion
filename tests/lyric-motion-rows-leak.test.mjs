// 文字同期の動きを持つ行の一覧(_lyricMotionRows)が、画面から外れた行を
// 抱え続けないこと。以前は足すだけで一度も外さず、曲が変わって消えた行と、
// 閉じた PiP の文書がまるごと残り続けた(PiP の開閉 1 回で文書 +1)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const pip = read('src/js/module/pip-manager.js')

const src = ui.slice(ui.indexOf('const _lyricMotionRows = new Set();'), ui.indexOf('// 動くのは伸ばした音だけ。'))

const run = (pipWindow) => {
  const document = { name: 'main' }
  const sandbox = { document, PipManager: { pipWindow } }
  vm.createContext(sandbox)
  vm.runInContext(`${src}\nglobalThis.rows = _lyricMotionRows; globalThis.forget = forgetDetachedLyricMotionRows;`, sandbox)
  return sandbox
}
const row = (ownerDocument, isConnected = true) => {
  const anim = { cancelled: false, cancel() { this.cancelled = true } }
  return { ownerDocument, isConnected, _motions: [anim], _motionReady: true, anim }
}

test('外れた行・閉じた PiP の行は外し、動きも止める。今の画面と開いている PiP の行は残す', () => {
  const openPipDoc = { name: 'pip-open' }
  const closedPipDoc = { name: 'pip-closed' }
  const sb = run({ closed: false, document: openPipDoc })
  const main = row(sb.document)
  const detached = row(sb.document, false)
  const openPip = row(openPipDoc)
  const closedPip = row(closedPipDoc)
  for (const r of [main, detached, openPip, closedPip]) sb.rows.add(r)
  sb.forget()
  assert.deepEqual([...sb.rows], [main, openPip])
  assert.equal(detached.anim.cancelled, true)
  assert.equal(closedPip.anim.cancelled, true)
  assert.equal(closedPip._motions, null)
  assert.equal(main.anim.cancelled, false)
})

test('PiP が閉じていれば PiP の行もすべて外す', () => {
  const pipDoc = { name: 'pip' }
  const sb = run(null)
  const r = row(pipDoc)
  sb.rows.add(r)
  sb.forget()
  assert.equal(sb.rows.size, 0)
})

test('足す時・一時停止の時・PiP を閉じた時に見直す', () => {
  assert.match(ui, /forgetDetachedLyricMotionRows\(\);\s*_lyricMotionRows\.add\(row\);/)
  assert.match(ui, /const pauseAllLyricWordMotion = \(\) => \{\s*forgetDetachedLyricMotionRows\(\);/)
  assert.match(pip, /addEventListener\('pagehide'[\s\S]{0,400}forgetDetachedLyricMotionRows\(\)/)
})
