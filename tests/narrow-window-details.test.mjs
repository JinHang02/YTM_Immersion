// 窓を縮めた時と、歌詞・シークバーの細かな見た目(報告 4 件)。
//
// 1. 狭い窓の新バー(ytmusic-miniplayer)は広い時の bottom: 40px のままで、
//    旧バー(24px)に合わせて置いた取得元の表示がバーの上端に 8px 被っていた
// 2. 狭い窓(900px 以下)で YTM が畳んだ検索欄(虫眼鏡だけ)に枠と背景が掛かり、
//    横に余裕があっても正方形の箱になっていた。開くと右へはみ出して切れていた
// 3. 薄い行は rgba の字を 1 つずつ重ね塗りするので、tt の横棒のように
//    字が重なる所だけ明るく浮いていた
// 4. 新バーでバーに乗せた時(シークバーの外)、つまみが線より 1px 下に出ていた。
//    旧バーの自前の丸は、乗せて太った線より 1px 上に出ていた
// どれも隔離 Chrome で 520 / 700 / 900 / 1280px の窓で確かめた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')
const pip = fs.readFileSync(new URL('../src/js/module/pip-manager.js', import.meta.url), 'utf8')
const ns = fs.readFileSync(new URL('../src/js/module/namespace.js', import.meta.url), 'utf8')

const block = (text, head) => {
  const start = text.indexOf(head)
  assert.notEqual(start, -1, `${head} が無い`)
  return text.slice(start, text.indexOf('}', start) + 1)
}

// 狭い画面の本体のブロック(max-width: 900px)の中身
const narrowBlock = () => {
  const start = css.indexOf('@media (max-width: 900px) {\n\n  /* 上段=見出し')
  assert.notEqual(start, -1, '狭い画面のブロックが見つからない')
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i)
  }
  throw new Error('ブロックが閉じていない')
}

test('狭い窓では新バーも旧バーと同じ 24px に下ろす(取得元の表示の位置と揃える)', () => {
  const narrow = narrowBlock()
  assert.match(block(narrow, 'body.ytm-custom-layout ytmusic-player-bar {'), /bottom: 24px !important/)
  assert.match(block(narrow, 'body.ytm-custom-layout ytmusic-miniplayer {'), /bottom: 24px !important/)
  // 取得元の表示はこの 24px を前提に置いている
  assert.match(block(narrow, 'body.ytm-custom-layout #ytm-lyrics-source-debug.ytm-source-inline {'),
    /bottom: calc\(24px \+ \(80px \* var\(--ytm-ui-scale, 1\)\) \+ 8px\)/)
})

test('畳んだ検索欄は残りの幅いっぱいに広げ、開いたらナビバーを基準にする', () => {
  assert.match(block(css, 'body.ytm-custom-layout ytmusic-nav-bar:has(ytmusic-search-box[is-mobile-view]) {'),
    /grid-template-columns: minmax\(max-content, 1fr\) minmax\(0, 480px\) minmax\(max-content, 1fr\) !important/)
  assert.match(block(css, 'body.ytm-custom-layout ytmusic-nav-bar ytmusic-search-box[is-mobile-view]:not([opened]):not([has-query]) {'),
    /width: 100% !important/)
  // 入力欄を出す(押すと開く)。細い時に切れた 1 字が残らないよう案内の文は消す
  assert.match(css, /@container ytmi-search \(width < 180px\)/)
  assert.match(block(css, 'body.ytm-custom-layout ytmusic-nav-bar:has(ytmusic-search-box[is-mobile-view]:is([opened], [has-query])) > .center-content.ytmusic-nav-bar {'),
    /position: static !important/)
})

test('薄い行は不透明の字をまとめて薄める(本体と PiP)', () => {
  const main = block(css, 'body.ytm-custom-layout:not(.ytm-no-timestamp) #my-lyrics-container .lyric-line:not(.active):not(.ytm-card-selected) .lyric-main {')
  assert.match(main, /color: #fff;/)
  // 元の行の色(rgba の 0.3)と同じ濃さ
  assert.match(css, /\n\.lyric-line \{[^}]*color: rgba\(255, 255, 255, 0\.3\);/)
  assert.match(main, /opacity: 0\.3;/)
  // 色分けした行は不透明の色のまま
  assert.match(block(css, 'body.ytm-custom-layout.ytm-singer-colors-enabled:not(.ytm-no-timestamp) #my-lyrics-container .lyric-line[data-singer-color]:not(.active):not(.ytm-card-selected) .lyric-main {'),
    /opacity: 1;/)

  const pipMain = block(pip, 'body:not(.ytm-no-timestamp) .lyric-line:not(.active) .lyric-main {')
  assert.match(pip, /\.lyric-line \{[^}]*color: rgba\(255, 255, 255, 0\.25\) !important;/)
  assert.match(pipMain, /opacity: 0\.25;/)
  assert.match(block(pip, 'body:not(.ytm-no-timestamp) .lyric-line:not(.active):hover .lyric-main {'), /opacity: 0\.6;/)
})

test('新バーのつまみは線の太さに合わせて真ん中に置く', () => {
  // (線 3px - 12px) / 2 と (線 5px - 12px) / 2
  assert.match(block(css, 'ytmusic-miniplayer .ytMusicMiniPlayerProgressBar::-webkit-slider-thumb {'), /margin-top: -4\.5px !important/)
  assert.match(block(css, 'ytmusic-miniplayer .ytMusicMiniPlayerProgressBar:is(:hover, :active, :focus-visible)::-webkit-slider-thumb {'),
    /margin-top: -3\.5px !important/)
})

test('旧バーの自前の丸は、線そのものの縦の中央に置く', () => {
  assert.match(ns, /querySelector\('#progressContainer'\)\?\.getBoundingClientRect\(\)/)
  assert.match(ns, /const handleY = yRect\.top \+ yRect\.height \/ 2;/)
})
