// 読み込み直した直後に広告が入ると、広告の後の曲の歌詞が Loading... のまま止まる。
//
// 曲を見つけた tick は、連打で途中の曲を取りに行かないよう 250ms 待ってから
// 歌詞を取りに行く。その 250ms の間に広告が始まると、MediaSession の曲名が
// 広告のもの(実機: 「NTT西日本 企業CM…」)に変わり、取りに行くのをやめていた。
// 広告が終わって曲名が元に戻っても、tick は覚えている曲と同じなので取り直さない。
// 実機(ログアウトの隔離 Chrome)で、広告が出た読み込み 3 回とも止まった。
// 直した後は広告の後に歌詞が出ることを確かめた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')

const debouncedLoad = () => {
  const start = uiSource.indexOf('    setTimeout(() => {\n      // この間に次の曲の切り替えを済ませていたら')
  assert.notEqual(start, -1, '曲の切り替え後の取得待ちが見つからない')
  const end = uiSource.indexOf('}, LYRICS_LOAD_DEBOUNCE_MS);', start)
  assert.notEqual(end, -1)
  const body = uiSource.slice(uiSource.indexOf('{', start) + 1, end)
  return body
}

const run = ({ metaNow, videoNow, stored = {} }) => {
  const key = 'Just the Way You Are///ブルーノ・マーズ'
  const videoId = 'LjhCEhWiKXk'
  const calls = []
  const ctx = {
    key,
    videoId,
    meta: { title: 'Just the Way You Are', artist: 'ブルーノ・マーズ' },
    currentKey: stored.currentKey ?? key,
    currentLyricsVideoId: stored.currentLyricsVideoId ?? videoId,
    getMetadata: () => metaNow,
    getCurrentVideoId: () => videoNow,
    loadLyrics: () => calls.push('load'),
    startLyricRafLoop: () => calls.push('raf'),
    requestImmersionTick: () => calls.push('tick'),
  }
  vm.runInNewContext(`(() => {${debouncedLoad()}})()`, ctx)
  return { calls, ctx }
}

test('曲名が変わっていなければ、そのまま取りに行く', () => {
  const { calls } = run({ metaNow: { title: 'Just the Way You Are', artist: 'ブルーノ・マーズ' }, videoNow: 'LjhCEhWiKXk' })
  assert.deepEqual(calls, ['load', 'raf'])
})

test('待つ間に広告の曲名になったら、切り替えを済ませていないことにして tick に任せる', () => {
  const { calls, ctx } = run({ metaNow: { title: 'NTT西日本 企業CM', artist: 'NTTWESTofficial' }, videoNow: 'LjhCEhWiKXk' })
  assert.deepEqual(calls, ['tick'])
  // 曲名が元に戻った時、tick が「動画が変わった」と見て取り直すようにする
  assert.equal(ctx.currentLyricsVideoId, null)
  // 曲の記録は残す(連続再生の位置の補正は「前の曲を追えていた」ことを使う)
  assert.equal(ctx.currentKey, 'Just the Way You Are///ブルーノ・マーズ')
})

test('待つ間に動画だけ変わった時も同じ', () => {
  const { calls, ctx } = run({ metaNow: { title: 'Just the Way You Are', artist: 'ブルーノ・マーズ' }, videoNow: 'other' })
  assert.deepEqual(calls, ['tick'])
  assert.equal(ctx.currentLyricsVideoId, null)
})

test('もう次の曲の切り替えを済ませていたら、何もしない', () => {
  const { calls, ctx } = run({
    metaNow: { title: 'Sugar', artist: 'Maroon 5' },
    videoNow: '09R8_2nJtjg',
    stored: { currentKey: 'Sugar///Maroon 5', currentLyricsVideoId: '09R8_2nJtjg' },
  })
  assert.deepEqual(calls, [])
  assert.equal(ctx.currentLyricsVideoId, '09R8_2nJtjg')
})
