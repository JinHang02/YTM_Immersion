// 描くものが無いのにページ全体のフレームを立てない(2026-10 の計測から)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const ns = read('src/js/module/namespace.js')
const css = read('src/css/style.css')

const loadSleep = (state) => {
  const start = ui.indexOf('const LYRIC_WAKE_EARLY_MS')
  const end = ui.indexOf('\n};\n', ui.indexOf('const lyricLoopSleepMs')) + 4
  return new Function('state', `
    let { lyricsData, config, _lyricCompletionSchedule, _activeRowsHaveCharSpans, animatedCaptionData,
      _lastRafPlaybackTime, _playbackRateForMotion } = state;
    const LYRIC_IDLE_TICK_MS = 250;
    ${ui.slice(start, end)}
    return lyricLoopSleepMs;`)(state)
}

test('行ごとの同期の歌詞は、次の行の少し前まで寝る(最長 250ms)', () => {
  const base = {
    lyricsData: [{ time: 10 }, { time: 12 }, { time: 20 }], config: {}, _lyricCompletionSchedule: [],
    _activeRowsHaveCharSpans: false, animatedCaptionData: null, _playbackRateForMotion: 1,
  }
  assert.equal(loadSleep({ ...base, _lastRafPlaybackTime: 11.0 })(), 250)
  assert.equal(Math.round(loadSleep({ ...base, _lastRafPlaybackTime: 11.8 })()), 120, '次の行の 80ms 前に起きる')
  assert.equal(loadSleep({ ...base, _lastRafPlaybackTime: 11.95 })(), 0, '近づいたら毎フレーム')
})

test('塗る文字(語・1 文字同期)がある間は毎フレーム', () => {
  const sleep = loadSleep({
    lyricsData: [{ time: 10 }, { time: 30 }], config: {}, _lyricCompletionSchedule: [],
    _activeRowsHaveCharSpans: true, animatedCaptionData: null, _lastRafPlaybackTime: 11, _playbackRateForMotion: 1,
  })
  assert.equal(sleep(), 0)
})

test('歌い終わりで薄くする設定なら、その時刻でも起きる', () => {
  const sleep = loadSleep({
    lyricsData: [{ time: 10 }, { time: 30 }], config: { fadePastLyrics: true }, _lyricCompletionSchedule: [{ end: 11.2 }],
    _activeRowsHaveCharSpans: false, animatedCaptionData: null, _lastRafPlaybackTime: 11, _playbackRateForMotion: 1,
  })
  assert.equal(Math.round(sleep()), 120)
})

test('寝るタイマーは PiP を開いている間は PiP の窓で頼む(裏のタブは間引かれる)', () => {
  assert.match(ui, /lyricIdleTimerWindow = PipManager\.pipWindow \|\| window;/)
  assert.match(ui, /\(lyricIdleTimerWindow \|\| window\)\.clearTimeout\(lyricIdleTimer\)/)
})

test('シークバーの丸は、掴んでいる間だけ毎フレーム追う。バーを隠している間は出さない', () => {
  assert.match(ns, /if \(isDragging\) _handleRafId = requestAnimationFrame\(updateHandlePosition\);\s*else _handleTimer = setTimeout\(updateHandlePosition, HANDLE_IDLE_MS\);/)
  assert.match(ns, /if \(isHovering && !progressBar\.matches\(':hover'\)\) isHovering = false;/)
  assert.match(ns, /!shouldShowHandle\(\) \|\| barHiddenNow\(\)/)
})

test('器の大きさの変化を窓の resize として送るのは動画モードだけ、始めと終わりの 2 回', () => {
  const fn = ui.slice(ui.indexOf('function setupMovieMode()'), ui.indexOf('const check = () =>', ui.indexOf('function setupMovieMode()')))
  assert.match(fn, /if \(moviemode !== true\) return;/)
  assert.match(fn, /if \(!settleTimer\) window\.dispatchEvent/)
  assert.match(fn, /settleTimer = null;\s*if \(!markMoviePlayerPath\(\)\) window\.dispatchEvent/)
})

test('動画モードの今の行は曲名と同じ真っ白', () => {
  assert.match(css, /\.lyric-line\.active\.moviemode \{\s*color: #fff;\s*\}/)
})

test('語の塗り(--sweep)はアニメーションにせずループで書く。回数は曲 60・動画 30 まで', () => {
  // CSS 変数のアニメーションは合成側で走れず、画面の書き換え回数(120Hz なら 120 回)だけ
  // メインスレッドで動く
  assert.doesNotMatch(ui, /'--sweep': xs\[i\]/)
  assert.doesNotMatch(ui, /_sweepAnimated/)
  assert.match(ui, /writeLyricVar\(row, '--sweep', '_sweep', lyricSweepAt\(row, t\), SWEEP_STEP\);/)
  assert.match(ui, /const frameMs = moviemode === true \? LYRIC_MOVIE_FRAME_MS : LYRIC_FRAME_MS;/)
  assert.match(ui, /const LYRIC_FRAME_MS = 1000 \/ 60;/)
  assert.match(ui, /const LYRIC_MOVIE_FRAME_MS = 1000 \/ 30;/)
})

test('見えないだけの YTM の右の欄と閲覧ページは、描く準備ごと飛ばす(映像の入った欄は除く)', () => {
  assert.match(css, /body\.ytm-custom-layout :is\(\.side-panel, #browse-page\):not\(\[data-ytmi-bar-path\]\) \{\s*content-visibility: hidden;/)
  const selectors = [...css.matchAll(/^([^{}\n]*)\{\s*content-visibility: hidden/gm)].map(m => m[1])
  assert.ok(selectors.length > 0)
  assert.ok(selectors.every(sel => !sel.includes('main-panel')), selectors.join(' | '))
})

test('動画モードは語を持ち上げず、映像のコマに合わせて塗る(合成の回数を映像に揃える)', () => {
  assert.match(ui, /row\._motionMovie = typeof moviemode !== 'undefined' && moviemode === true;\s*if \(row\._motionMovie\) return;/)
  assert.match(ui, /if \(row\._motionReady && row\._motionMovie !== \(typeof moviemode !== 'undefined' && moviemode === true\)\) dropLyricWordMotion\(row\);/)
  assert.match(ui, /moviemode === true && !PipManager\.pipWindow && !document\.hidden/)
  assert.match(ui, /lyricVfcId = video\.requestVideoFrameCallback\(onFrame\);/)
  // コマが来ない(一時停止・読み込み待ち)時もタイマーで起きる
  assert.match(ui, /cancelLyricVfc\(\);\s*loop\(\);\s*\}, LYRIC_IDLE_TICK_MS\);/)
  assert.match(ui, /const cancelLyricRaf = \(\) => \{\s*cancelLyricVfc\(\);/)
})

test('動画モードでは、映像の下に隠れた以前の CSS の背景を動かさない', () => {
  assert.match(ui, /document\.body\.classList\.toggle\('ytm-movie-mode', !!moviemode\);/)
  assert.match(ui, /moviemode = null;\s*document\.body\.classList\.remove\('ytm-movie-mode'\);/)
  assert.match(css, /body\.ytm-custom-layout\.ytm-movie-mode #ytm-custom-bg \{\s*animation: none !important;/)
  assert.match(css, /body\.ytm-custom-layout\.ytm-movie-mode #ytm-custom-bg::after \{\s*display: none !important;/)
})

test('縦長の窓の動画モードは、映像・曲名・歌詞を縦に積む。横長の狭い窓は横長の作りのまま', () => {
  assert.match(css, /@media \(max-aspect-ratio: 5\/4\) \{[\s\S]{0,80}body\.ytm-custom-layout \{\s*--ytm-mv-top:/)
  assert.match(css, /@media \(max-width: 900px\) and \(min-aspect-ratio: 5\/4\) \{/)
  // 歌詞の余白は帯の高さから(20vh だと帯より高くなる)
  assert.match(css, /padding-top: calc\(var\(--ytm-mv-lyrics-h\) \* 0\.35\);/)
})


test('動画モードの映像は器へ移さず、YTM の置いた場所のまま印を付けて見せる', () => {
  // YTM は横長用と狭い窓用で別の ytmusic-player を持ち、入れ替える。器へ移すと
  // 入れ替えから外れて古いものが溜まり、曲モードが崩れ、映像も消えた(実機)
  assert.doesNotMatch(ui, /customParent\.prepend\(video\)/)
  assert.doesNotMatch(ui, /wrapper\.prepend\(player\)/)
  const fn = ui.slice(ui.indexOf('const markMoviePlayerPath'), ui.indexOf('function setupMovieMode()'))
  assert.match(fn, /const live = on \? liveYtmPlayer\(\) : null;/)
  assert.match(fn, /for \(let p = live\.parentElement; p && p !== document\.body; p = p\.parentElement\) path\.add\(p\);/)
  assert.match(ui, /const liveYtmPlayer = \(\) => document\.getElementById\('movie_player'\)\?\.closest\('ytmusic-player'\)/)
  assert.match(ui, /ensureModeToggle\(false\);\s*markMoviePlayerPath\(\);/)
  assert.match(css, /body\.ytm-custom-layout ytmusic-player\[data-ytmi-movie-player\] \{\s*position: fixed !important;/)
  assert.match(css, /body\.ytm-custom-layout\.ytm-movie-mode ytmusic-player-page\[data-ytmi-video-path\] \{\s*z-index: 1001 !important;/)
  assert.match(css, /body\.ytm-custom-layout\.ytm-movie-mode #ytm-custom-wrapper \{\s*z-index: 1002;/)
})

test('曲/動画の切り替えは、移す前の居場所へ戻す(番号で決めない)', () => {
  assert.doesNotMatch(ui, /originParent\.children\[1\]/)
  assert.match(ui, /rememberYtmHome\(switcher\);\s*customSwitcherParent\.appendChild\(switcher\);/)
  assert.match(ui, /returnYtmHome\(switcher, originParent\);/)
})
