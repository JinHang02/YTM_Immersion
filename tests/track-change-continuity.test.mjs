// 曲送りの切り替わりを 1 回で、途切れなく済ませる。
//
// 実機(music.youtube.com)で曲送りを 1 フレームずつ追うと:
//   - URL とプレイヤーバーの曲名が先に新しい曲になり、MediaSession は
//     80ms 前後遅れて追いつく。その間に tick が走り、「新しい videoId +
//     前の曲の題名」で曲の切り替えを 1 回、追いついてもう 1 回やっていた。
//   - ジャケットは読み込みの間(150〜570ms)空の枠になり、曲送りのたびに
//     点滅していた。
//   - 歌詞は先読み済みでも 1.5 秒ほど空だった(取得の前に 800ms 待っていた)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

const loadSettle = () => {
  const state = { bar: '', now: 0, retries: 0 }
  const context = vm.createContext({
    document: { querySelector: () => ({ textContent: state.bar }) },
    performance: { now: () => state.now },
    setTimeout: () => { state.retries += 1; return 1 },
    clearTimeout: () => {},
    requestImmersionTick: () => {},
    currentLyricsVideoId: 'old',
    PLAYER_BAR_TITLE_SELECTOR: 'title',
  })
  vm.runInContext(
    `${sliceBetween('const META_SETTLE_MAX_MS', 'let _cachedLayoutEl = null;')}
    this.wait = shouldWaitForSettledMetadata;`,
    context,
  )
  return { state, wait: context.wait }
}

test('バーが新しい曲、MediaSession がまだ前の曲なら、切り替えを待つ', () => {
  const { state, wait } = loadSettle()
  state.bar = '愛♡スクリ～ム！'
  assert.equal(wait({ title: '唱' }, 'new'), true)
  assert.equal(state.retries, 1, '追いついたか見直す予約が無い')
})

test('追いついたら、その回で切り替える', () => {
  const { state, wait } = loadSettle()
  state.bar = '愛♡スクリ～ム！'
  wait({ title: '唱' }, 'new')
  state.now = 90
  assert.equal(wait({ title: '愛♡スクリ～ム！' }, 'new'), false)
})

test('バーの「（feat. …）」付きの曲名は食い違いとみなさない', () => {
  const { state, wait } = loadSettle()
  state.bar = '透明夜（feat. 可不）'
  assert.equal(wait({ title: '透明夜' }, 'new'), false)
  state.bar = 'すずめ (feat. 十明)'
  assert.equal(wait({ title: 'すずめ' }, 'new'), false)
})

test('食い違ったままでも 1.5 秒で先へ進む', () => {
  const { state, wait } = loadSettle()
  state.bar = 'Song B'
  assert.equal(wait({ title: 'Song A' }, 'new'), true)
  state.now = 1499
  assert.equal(wait({ title: 'Song A' }, 'new'), true)
  state.now = 1500
  assert.equal(wait({ title: 'Song A' }, 'new'), false)
})

test('曲が変わっていない時や、曲名が読めない時は待たない', () => {
  const { state, wait } = loadSettle()
  state.bar = 'Song B'
  assert.equal(wait({ title: 'Song A' }, 'old'), false)
  assert.equal(wait({ title: 'Song A' }, ''), false)
  state.bar = ''
  assert.equal(wait({ title: 'Song A' }, 'new'), false)
})

test('曲名もアーティスト名も空の間は待つ(広告の切り替わり)。1.5 秒たったら従来どおり進む', () => {
  // 進めると空のまま歌詞を問い合わせ、LRCHub は REQUIRED_TRACK_ARTIST で断り、
  // 結果は「///」というキーでキャッシュに残っていた
  const { state, wait } = loadSettle()
  state.bar = ''
  // 同じ曲(広告が曲の途中に挟まった時)でも、新しい曲でも待つ
  assert.equal(wait({ title: '', artist: '' }, 'old'), true)
  assert.equal(state.retries, 1, '埋まったか見直す予約が無い')
  state.now = 1499
  assert.equal(wait({ title: ' ', artist: '' }, 'old'), true)
  state.now = 1500
  assert.equal(wait({ title: '', artist: '' }, 'old'), false)
  // どちらか片方でもあれば、空とはみなさない(従来どおり)
  const other = loadSettle()
  assert.equal(other.wait({ title: 'Song A', artist: '' }, 'old'), false)
  assert.equal(other.wait({ title: '', artist: 'Artist' }, 'old'), false)
})

test('空の間の待ちは、曲名の食い違いの待ちと数え始めを分ける', () => {
  const { state, wait } = loadSettle()
  wait({ title: '', artist: '' }, 'new')
  state.now = 1400
  // 埋まった後に曲名が食い違えば、そこから 1.5 秒待てる
  state.bar = 'Song B'
  assert.equal(wait({ title: 'Song A', artist: 'X' }, 'new'), true)
  state.now = 2800
  assert.equal(wait({ title: 'Song A', artist: 'X' }, 'new'), true)
})

test('tick は曲の切り替えを判定する前に、メタデータが揃うのを待つ', () => {
  const tick = sliceBetween('const tick = async () => {', '// 背景に使う画像の読み込み世代。')
  const waitAt = tick.indexOf("if (shouldWaitForSettledMetadata(meta, getCurrentVideoId() || '')) return;")
  assert.ok(waitAt !== -1)
  assert.ok(waitAt < tick.indexOf('_wasTrackingPlayback = true;'))
  assert.ok(waitAt < tick.indexOf('if (currentKey !== key ||'))
})

test('歌詞の取得前の待ちは連打よけの短い間だけ', () => {
  assert.match(uiSource, /const LYRICS_LOAD_DEBOUNCE_MS = (\d+);/)
  const ms = Number(uiSource.match(/const LYRICS_LOAD_DEBOUNCE_MS = (\d+);/)[1])
  assert.ok(ms <= 300, `${ms}ms 待っている`)
  assert.match(uiSource, /\}, LYRICS_LOAD_DEBOUNCE_MS\);/)
})

test('同じ曲のままジャケットだけ変わったら差し替える(動画→曲で MV のサムネイルが残らない)', () => {
  assert.match(uiSource, /\} else \{\s*if \(meta\.src && meta\.src !== _artworkSrcShown\) \{\s*(\/\/[^\n]*\n\s*)*updateArtworkUI\(meta\);/)
  assert.match(uiSource, /_artworkSrcShown = meta\.src;/)
  // 曲(ATV)なのに MediaSession が MV のサムネイルの時は、バーのジャケットを使う
  const pick = sliceBetween('const pickArtworkSrc = (sessionSrc) => {', 'const getMetadata = () => {')
  assert.match(pick, /mode !== 'ATV_PREFERRED'/)
  assert.match(pick, /shownId === currentId\) return sessionSrc;/)
  assert.match(pick, /googleusercontent/)
})

test('新しいジャケットが読み終わるまで前のジャケットを外さない', () => {
  const meta = sliceBetween('function updateArtworkUI(meta) {', 'function updateArtistLink(meta) {')
  // 差し替えは placeArtwork の中だけ
  assert.equal(meta.split('ui.artwork.replaceChildren(img)').length - 1, 1)
  assert.match(meta, /img\.onload = \(\) => \{\s*if \(bgToken !== _bgLoadToken\) return;[^\n]*\n\s*placeArtwork\(\);/)
  assert.match(meta, /setTimeout\(placeArtwork, ARTWORK_SWAP_MAX_WAIT_MS\)/)
  // 初めての曲(前のジャケットが無い)はすぐ置く
  assert.match(meta, /if \(!ui\.artwork\.querySelector\('img'\)\) placeArtwork\(\);/)
  // キャッシュを毎回捨てる目印を付けない
  assert.doesNotMatch(meta, /ytm_cors['"]?, Date\.now\(\)|ytm_cors=' \+ Date\.now\(\)/)
})
