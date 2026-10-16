// Apple Music 風の背景(fluid-bg.js)は 1 秒 FPS 回しか描かない。
// 以前は描かないフレームでも毎回 rAF を頼み直していて、歌詞が止まっている間
// (時刻の無い歌詞・歌詞の無い曲)もページ全体のフレームの組み立てが
// 1 秒 60 回走っていた。描いた後はタイマーで待ってから rAF を頼む。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const src = fs.readFileSync(new URL('../src/js/module/fluid-bg.js', import.meta.url), 'utf8')
const draw = src.slice(src.indexOf('const draw = (now) => {'), src.indexOf('const drawOnce = (now) => {'))

test('描いた後は rAF をすぐ頼まず、タイマーで待つ', () => {
  // 冒頭で無条件に rAF を頼み直していない
  assert.doesNotMatch(draw.slice(0, draw.indexOf('const early')), /requestAnimationFrame/)
  assert.match(draw, /waitTimer = setTimeout\(\(\) => \{[\s\S]*?requestAnimationFrame\(draw\)/)
})

test('止める時はタイマーも止め、動いているかはタイマーも含めて答える', () => {
  assert.match(src, /const stop = \(\) => \{[\s\S]*?clearTimeout\(waitTimer\);[\s\S]*?\};/)
  assert.match(src, /if \(!rafId && !waitTimer\) rafId = requestAnimationFrame\(draw\);/)
  assert.match(src, /isRunning: \(\) => !!\(rafId \|\| waitTimer\)/)
})
