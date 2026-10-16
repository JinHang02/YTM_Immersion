// 本文が合っていても時刻がずれた歌詞を出さない(lyrics-agreement.js の時刻の突き合わせ)。

import assert from 'node:assert/strict'
import test from 'node:test'
import * as A from '../src/js/module/lyrics-agreement.js'

const LINES = ['君はハニーデュー甘いメロンさ', 'いつのころか好きになってた', '世界中にメロンはあるのに', '特別な存在',
  'なぜなんだろう気に入ったのは', 'もう君以外目に留まらない', 'こんなに好きになっちゃダメかな', '一番最初どこで会ったっけ']
const stamp = (t) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`
const lrc = (shift) => LINES.map((l, i) => stamp(10 + i * 4 + shift(i)) + l).join('\n')
const good = lrc(() => 0)
const near = lrc(() => 0.3)
const late3 = lrc(() => 3)
const drifting = lrc(i => i * 0.6)
const judge = (entries) => Object.fromEntries(A.judgeLyrics(entries, { track: '君はハニーデュー' }))

test('全体が数秒ずれたものは、ほかの 2 つが合っていれば外れ', () => {
  assert.deepEqual(judge([
    { providerId: 'lrchub', lyrics: good }, { providerId: 'lrclib', lyrics: near }, { providerId: 'simpmusic', lyrics: late3 },
  ]), { lrchub: 'confirmed', lrclib: 'confirmed', simpmusic: 'contradicted' })
})

test('途中から少しずつずれていくもの(別の版の時刻)も外れ', () => {
  assert.equal(judge([
    { providerId: 'lrchub', lyrics: good }, { providerId: 'netease', lyrics: near }, { providerId: 'lrclib', lyrics: drifting },
  ]).lrclib, 'contradicted')
})

test('同じファイルの写しは 1 票。1 対 1 なら決めない', () => {
  const v = judge([
    { providerId: 'lrchub', lyrics: good }, { key: 'a', providerId: 'lrclib', lyrics: late3 }, { key: 'b', providerId: 'simpmusic', lyrics: late3 },
  ])
  assert.deepEqual(Object.values(v), ['confirmed', 'confirmed', 'confirmed'])
})

test('YouTube Music 自身の時刻があれば、それに合うものが正しい(数で負けても)', () => {
  const v = judge([
    { providerId: 'lrclib', lyrics: late3 }, { providerId: 'simpmusic', lyrics: lrc(() => 3.1) },
    { providerId: 'lrchub', lyrics: good }, { providerId: 'ytm', lyrics: near },
  ])
  assert.equal(v.lrchub, 'confirmed')
  assert.equal(v.lrclib, 'contradicted')
  assert.equal(v.simpmusic, 'contradicted')
})

test('2 つが食い違うだけ・時刻の無い歌詞とは、時刻では判断しない', () => {
  assert.deepEqual(judge([{ providerId: 'lrchub', lyrics: good }, { providerId: 'lrclib', lyrics: late3 }]),
    { lrchub: 'confirmed', lrclib: 'confirmed' })
  assert.deepEqual(judge([{ providerId: 'lrchub', lyrics: good }, { providerId: 'ytm', lyrics: LINES.join('\n') }]),
    { lrchub: 'confirmed', ytm: 'confirmed' })
})

test('行は本文で対応を取る(片方にだけ合いの手があってもずれない)', () => {
  const withAdlib = LINES.flatMap((l, i) => [stamp(10 + i * 4) + l, ...(i % 3 === 0 ? [stamp(11.5 + i * 4) + 'Yeah!'] : [])]).join('\n')
  assert.equal(A.timingAgreement(good, withAdlib), 1)
  assert.equal(A.timingAgreement(good, late3), 0)
})
