// 操作バーを自動で隠す(bar-autohide.js)。
//
//   - マウスが画面の下に来た時だけ出し、離れたら隠す
//   - フォーカスでは決めない: マウスで押したボタンにもフォーカスは残り、YTM も
//     読み込み時にバーのボタンへプログラムでフォーカスを当てる。:focus-within /
//     :focus-visible で見ていた時は、それだけで二度と隠れなかった(実機)
//   - 隠し方は動画モードで隠れる時と同じ(濃さ・visibility・押せなくする)
//   - 「設定をリセット」で消える

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const src = read('src/js/module/bar-autohide.js')
const ui = read('src/js/module/lyrics-ui.js')
const css = read('src/css/style.css')
const manifest = JSON.parse(read('manifest.json'))

test('フォーカスの擬似クラスでは「隠さない」を決めない', () => {
  const code = src.replace(/\/\/.*$/gm, '')
  assert.ok(!/:focus-within|:focus-visible/.test(code), 'フォーカスの擬似クラスを見ている')
  assert.match(code, /e\.key === 'Tab'/)
})

test('隠すのは Immersion を開いていて、ytm-bar-peek が無い時だけ', () => {
  assert.match(css, /body\.ytm-custom-layout\.ytm-bar-autohide:not\(\.ytm-bar-peek\) :is\(\[data-ytmi-bar\], #ytmi-fallback-bar\)[^{]*\{[^}]*opacity: 0 !important;[^}]*pointer-events: none !important;/)
})

test('出し入れは薄れながら下がる(YTM の読み込み時の動きを外して、濃さを補間させる)', () => {
  assert.match(css, /body\.ytm-custom-layout \[data-ytmi-bar\] \{\s*animation: none !important;/)
  assert.match(css, /body\.ytm-custom-layout :is\(\[data-ytmi-bar\], #ytmi-fallback-bar\) \{\s*transition: opacity [^;]*translate [^;]*!important;/)
  assert.match(css, /:not\(\.ytm-bar-peek\)[^{]*\{[^}]*translate: 0 24px;/)
})

test('設定をリセットすると消える・lyrics-ui より先に読み込む', () => {
  assert.match(ui, /const SETTINGS_STORAGE_KEYS = \[[\s\S]*?'ytm_bar_autohide'[\s\S]*?\];/)
  const js = manifest.content_scripts[0].js
  assert.ok(js.indexOf('src/js/module/bar-autohide.js') >= 0)
  assert.ok(js.indexOf('src/js/module/bar-autohide.js') < js.indexOf('src/js/module/lyrics-ui.js'))
})

test('自動で隠している間は、自前のバーに切り替えず、IMMERSION ボタンも浮かせない', () => {
  // 隠れたバーは押せないので、当たり判定をすると自前のバーが出ていた(動画から戻った後など)
  assert.match(ui, /const barHiddenOnPurpose = \(\) => !!moviemode\s*\|\| \(document\.body\.classList\.contains\('ytm-bar-autohide'\) && !document\.body\.classList\.contains\('ytm-bar-peek'\)\);/)
  assert.match(ui, /PlayerBar\.check\(\{ shown, skip: barHiddenOnPurpose\(\) \}\)/)
  // 置き場所は「並んでいるか」で見る(visibility: hidden でも置ける)
  assert.match(ui, /const barMayBeAutoHidden = \(\) => !!moviemode \|\| document\.body\.classList\.contains\('ytm-bar-autohide'\);/)
  assert.match(ui, /if \(isUsableToggleSpot\(el\) && \(barMayBeAutoHidden\(\) \|\| isHitTestable\(el\)\)\) return/)
})

test('バーが隠れている間は、バーのための余白を取らない(曲モードは器の下の余白、動画モードは持ち上げ量)', () => {
  // 曲モード: 器の下の余白を上と同じにする(画面ごとの実測値は使わない)
  assert.match(css, /ytm-bar-autohide:not\(\.ytm-bar-peek\) #ytm-custom-wrapper \{\s*padding-bottom: calc\(60px \* var\(--ytm-ui-scale\)\);/)
  assert.doesNotMatch(css, /#ytm-custom-left-col:not\(\.moviemode\) \{\s*translate/)
  // 動画モード: YT-Immersion と同じ位置(曲名 下 80px・歌詞 下 60px・高さ 40vh)に、バーの分の持ち上げを足す
  assert.match(css, /bottom: calc\(80px \+ var\(--ytm-movie-bar-lift, 0px\)\);/)
  assert.match(css, /bottom: calc\(60px \+ var\(--ytm-movie-bar-lift, 0px\)\);\s*height: 40vh;/)
  assert.match(css, /#ytm-custom-wrapper:has\(#ytm-custom-title\.inactive\),[\s\S]{0,120}\{\s*--ytm-movie-bar-lift: 0px;/)
})
