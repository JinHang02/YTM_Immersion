// 歌詞カード(lyric-card.js)。
//
// 聴いている曲の歌詞から 1〜4 行を選び、Immersion と同じ見た目の画像にして
// コピー・保存する。実機で確かめたこと:
//   - ボタンで選ぶ状態になり、いま歌っている行が選ばれている
//   - 行を押してもシークしない。外を押すと広がり、4 行を超えない
//   - Esc でやめると、歌っている行への追従が戻る
//   - 曲が変わる・広告が始まると選ぶ状態を閉じる
//   - 歌詞が無い曲では「選べる歌詞がありません」と出す
//   - カードは 1600×900(16:9、X や Discord で切れない)で作られ、コピー・X に投稿・
//     リンクのコピー・保存・Esc で閉じる

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const cardSource = read('src/js/module/lyric-card.js')
const uiSource = read('src/js/module/lyrics-ui.js')
const nsSource = read('src/js/module/namespace.js')
const manifest = JSON.parse(read('manifest.json'))

const load = () => {
  const context = vm.createContext({ ui: {}, t: (k) => k, Intl, console })
  vm.runInContext(`${cardSource}\nthis.LyricCard = LyricCard;`, context)
  return context.LyricCard
}

test('範囲の外を押すとそこまで広げ、4 行を超えない', () => {
  const { _nextRange: next } = load()
  assert.deepEqual([...next([5, 5], 7, 4)], [5, 7])
  assert.deepEqual([...next([5, 7], 12, 4)], [9, 12])
  assert.deepEqual([...next([5, 7], 3, 4)], [3, 6])
})

test('範囲の中を押すと、その 1 行から選び直す', () => {
  const { _nextRange: next } = load()
  assert.deepEqual([...next([5, 8], 6, 4)], [6, 6])
  assert.deepEqual([...next([5, 5], 5, 4)], [5, 5])
})

// 1 文字 = 10px として測る
const fakeCtx = { measureText: (s) => ({ width: [...s].length * 10 }) }

test('語の途中で折り返さず、幅に収める', () => {
  const { _wrap: wrap } = load()
  const lines = wrap(fakeCtx, 'Oh my savior oh my saving grace', 120)
  assert.ok(lines.length >= 2)
  for (const line of lines) {
    assert.ok([...line].length * 10 <= 130, `はみ出している: ${line}`)
    assert.ok(!/^\s/.test(line) && !/\s$/.test(line), `前後に空白: "${line}"`)
  }
  assert.equal(lines.join(' ').replace(/\s+/g, ' '), 'Oh my savior oh my saving grace')
})

test('句読点や閉じ括弧を行頭に置かない', () => {
  const { _wrap: wrap } = load()
  const lines = wrap(fakeCtx, '誰もが目を奪われてく、君は完璧で究極のアイドル」', 100)
  for (const line of lines.slice(1)) {
    assert.doesNotMatch(line, /^[、。」』）]/, `行頭に句読点: ${line}`)
  }
})

test('1 語が幅を超える時は字で切る', () => {
  const { _wrap: wrap } = load()
  const lines = wrap(fakeCtx, 'Supercalifragilistic', 80)
  assert.ok(lines.length >= 3)
  assert.equal(lines.join(''), 'Supercalifragilistic')
})

test('日本語は本体の歌詞と同じ文節の切れ目で切り、行の長さを揃える', () => {
  // 文節の切れ目は lyrics-ui.js の budouxPhraseBoundaries(ここでは決め打ちの偽物)
  const context = vm.createContext({
    ui: {}, t: (k) => k, Intl, console,
    budouxPhraseBoundaries: (text) => text === '逃げようとしたって結果は同じだ' ? [9, 12] : null,
  })
  vm.runInContext(`${cardSource}\nthis.LyricCard = LyricCard;`, context)
  const lines = context.LyricCard._wrap(fakeCtx, '逃げようとしたって結果は同じだ', 120)
  // 前から詰めると「逃げようとしたって結果 / は同じだ」になりうるが、文節の中では切らない。
  // いちばん長い文節(9 字)より狭めないので「したっ / て」にもならない
  assert.deepEqual([...lines], ['逃げようとしたって', '結果は同じだ'])
})

test('同じ行数のまま、いちばん狭い幅で組み直す(2 行目に数文字だけ残さない)', () => {
  const { _wrap: wrap } = load()
  const lines = wrap(fakeCtx, 'aa bb cc dd ee ff gg', 170)
  assert.equal(lines.length, 2)
  const lens = lines.map(l => [...l].length)
  assert.ok(Math.abs(lens[0] - lens[1]) <= 3, `長さが揃っていない: ${lines.join(' / ')}`)
})

test('content script として lyrics-ui.js より前に読み込む', () => {
  const js = manifest.content_scripts[0].js
  const card = js.indexOf('src/js/module/lyric-card.js')
  assert.ok(card !== -1)
  assert.ok(card < js.indexOf('src/js/module/lyrics-ui.js'))
})

test('ボタン列から開き、曲の切り替え・広告・Immersion の外では閉じる', () => {
  assert.match(uiSource, /label: 'btn_lyric_card',\s*click: \(\) => \{ if \(typeof LyricCard !== 'undefined'\) LyricCard\.start\(\); \}/)
  assert.match(uiSource, /btns\.push\([^)]*lyricCardBtnConfig/)
  const cancels = uiSource.match(/if \(typeof LyricCard !== 'undefined'\) LyricCard\.cancel\(\);/g) || []
  assert.equal(cancels.length, 3)
})

test('選んでいる間は自動で歌っている行へ寄せない', () => {
  assert.match(uiSource, /if \(isUserScrolling \|\| _lyricsAutoFollowHold\) continue;/)
  assert.match(uiSource, /function setLyricsAutoFollowHold\(on\) \{[\s\S]*_lastScrolledIndex = -1;/)
  assert.match(cardSource, /setLyricsAutoFollowHold\(true\)/)
  assert.match(cardSource, /setLyricsAutoFollowHold\(false\)/)
})

test('選んでいる間は行を押してもシークしない', () => {
  assert.match(cardSource, /ui\.lyrics\.addEventListener\('click', onRowClick, true\)/)
  const handler = cardSource.slice(cardSource.indexOf('const onRowClick'), cardSource.indexOf('const onKey'))
  assert.match(handler, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);/)
})

test('文言は 4 言語ぶんある', () => {
  for (const key of ['btn_lyric_card', 'lyric_card_title', 'lyric_card_selected', 'lyric_card_hint', 'lyric_card_make', 'lyric_card_cancel', 'lyric_card_unavailable', 'lyric_card_failed']) {
    assert.equal((nsSource.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 4, key)
  }
})

test('画像はどこにも送らない', () => {
  assert.doesNotMatch(cardSource, /\bfetch\(|sendMessage|XMLHttpRequest/)
})

test('X や Discord で切れない 16:9 で作る', () => {
  assert.match(cardSource, /const W = 1600;/)
  assert.match(cardSource, /const H = 900;/)
})

test('X に投稿は、画像をコピーしてから文とリンクの入った投稿画面を開く(画像は送らない)', () => {
  const fn = cardSource.slice(cardSource.indexOf("xBtn.onclick = async () => {"), cardSource.indexOf('};', cardSource.indexOf("xBtn.onclick = async () => {")))
  assert.ok(fn.indexOf('copyImage(blob)') < fn.indexOf('window.open('), 'コピーより先に開いている')
  assert.match(fn, /https:\/\/x\.com\/intent\/tweet\?/)
  assert.match(cardSource, /music\.youtube\.com\/watch\?v=/)
})
