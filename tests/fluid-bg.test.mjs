// Apple Music 風の背景(fluid-bg.js、WebGL)。
//
//   - 以前の背景は画面の 2 倍角(200vmax)の 2 枚を回していて、合成用の面だけで
//     数百 MB 使い、GPU も重かった(隔離 Chrome で GPU 8.1 秒/分 → 3.8 秒/分)。
//     軽さの前提(小さく描いて引き伸ばす・回数を絞る)を崩さない。
//   - 明るさは canvas の中で掛ける(背景の明るさ 0 で真っ黒になる)。
//   - 描いている間は以前の背景の 2 枚とアニメーションを止める。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const src = read('src/js/module/fluid-bg.js')
const ui = read('src/js/module/lyrics-ui.js')
const css = read('src/css/style.css')
const manifest = JSON.parse(read('manifest.json'))

test('小さく描いて引き伸ばし、描く回数を絞る', () => {
  const div = Number(src.match(/const RES_DIV = (\d+);/)[1])
  const fps = Number(src.match(/const FPS = (\d+);/)[1])
  assert.ok(div >= 4, `RES_DIV=${div}`)
  assert.ok(fps <= 15, `FPS=${fps}`)
})

test('明るさは <html> の style から読み、シェーダーで掛ける', () => {
  assert.match(src, /document\.documentElement\.style/)
  assert.match(src, /'--ytm-bg-brightness'/)
  assert.match(src, /'--ytm-bg-art-dim'/)
  assert.match(src, /\* uBright/)
  assert.ok(!/getComputedStyle/.test(src.replace(/\/\/.*$/gm, '')), 'getComputedStyle はスタイルの計算を起こす')
})

test('描いている間は以前の背景を止める', () => {
  assert.match(css, /body\.ytm-custom-layout\.ytm-fluid-bg #ytm-custom-bg::before,\s*body\.ytm-custom-layout\.ytm-fluid-bg #ytm-custom-bg::after \{\s*display: none !important;/)
  assert.match(css, /body\.ytm-custom-layout\.ytm-fluid-bg #ytm-custom-bg \{[^}]*filter: none !important;[^}]*animation: none !important;/)
})

test('出すか・動かすかを分けて渡す(一時停止中は最後の 1 枚を出したまま)', () => {
  assert.match(ui, /FluidBg\.update\(\{ show, animate, host: ui\.bg \}\)/)
  assert.match(ui, /const animate = show && !document\.hidden && !\(video && video\.paused\);/)
})

test('lyrics-ui より先に読み込む', () => {
  const js = manifest.content_scripts[0].js
  assert.ok(js.indexOf('src/js/module/fluid-bg.js') >= 0)
  assert.ok(js.indexOf('src/js/module/fluid-bg.js') < js.indexOf('src/js/module/lyrics-ui.js'))
})
