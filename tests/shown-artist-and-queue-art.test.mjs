// 縦長の窓を経るとアーティスト名が英字になる件と、Up Next のジャケットが
// 出ない件。
//
// ・窓が狭い時の YTM のバーはアーティスト名をリンクにしない(実機)。その間に
//   曲が変わると(動画→曲でも videoId が変わる)、リンクを探しきれずに
//   MediaSession の名前を出していた。曲版の MediaSession は英字のことがあり
//   (日向坂46 →「Hinatazaka46」)、窓を広げても組み直さなかった。
// ・Up Next の画像は YTM のキューの img(画面外は 1x1 の data:)か、
//   InnerTube で引き直したキューから曲名で探していた。引き直したキューは
//   今の曲から始めたラジオで、実際のキューと中身が違い、半分以上が記号だった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const queueSource = read('src/js/module/queue-manager.js')
const bridgeSource = read('src/js/page/queue-bridge.js')
const manifest = JSON.parse(read('manifest.json'))

test('リンクにできない時は、MediaSession ではなくバーに出ている名前を出す', () => {
  assert.match(uiSource, /const showArtistNameOnly = \(meta\) => \{\s*ui\.artist\.innerText = readShownArtistName\(meta\) \|\| meta\.artist;/)
  assert.doesNotMatch(uiSource, /ui\.artist\.innerText = meta\.artist/)
  // 名前だけで出した曲は、バーにリンクが戻ったら組み直す
  assert.match(uiSource, /if \(_artistLinkPendingKey === currentKey && barHasArtistLinks\(\)\) updateArtistLink\(meta\);/)
})

test('バーの byline を探す時、キューの行の byline は拾わない', () => {
  assert.match(uiSource, /el\.closest\('ytmusic-player-queue-item'\)/)
  assert.doesNotMatch(uiSource, /PlayerBar\.query\(ARTIST_BYLINE_SELECTOR\)[^;]*;\s*\n(?!\s*return el &&)/)
})

test('PiP にも Immersion と同じ表記のアーティスト名を渡す', () => {
  assert.match(uiSource, /PipManager\.updateMeta\(shownTitleFor\(meta\), \(ui\.artist && ui\.artist\.textContent\) \|\| meta\.artist\)/)
})

test('ページ側の橋渡しが、キューの行に videoId と小さめのサムネイルを写す', () => {
  const main = manifest.content_scripts.find(c => c.world === 'MAIN')
  assert.ok(main.js.includes('src/js/page/queue-bridge.js'))
  assert.doesNotMatch(bridgeSource, /fetch\(|XMLHttpRequest|postMessage/)

  const listeners = {}
  const attrs = {}
  const item = {
    data: {
      videoId: 'abc123def45',
      thumbnail: { thumbnails: [
        { url: 'https://i.ytimg.com/vi/abc123def45/default.jpg', width: 60 },
        { url: 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg', width: 400 },
        { url: 'https://i.ytimg.com/vi/abc123def45/hq720.jpg', width: 853 },
      ] },
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v },
  }
  const document = {
    querySelectorAll: () => [item],
    addEventListener: (type, fn) => { listeners[type] = fn },
  }
  vm.runInNewContext(bridgeSource, { document })
  listeners['ytmi-queue-stamp']()
  assert.equal(attrs['data-ytmi-video-id'], 'abc123def45')
  assert.equal(attrs['data-ytmi-thumb'], 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg')
})

test('Up Next は写してもらった videoId とサムネイルを使い、落ちたら次の候補を試す', () => {
  assert.match(queueSource, /document\.dispatchEvent\(new CustomEvent\('ytmi-queue-stamp'\)\);\s*const allRawItems/)
  assert.match(queueSource, /const stamped = queueItem\.getAttribute\('data-ytmi-video-id'\);\s*if \(stamped\) return stamped;/)
  assert.match(queueSource, /item\.getAttribute\('data-ytmi-thumb'\)/)
  // 引き直したキューの画像は、videoId が同じ時だけ使う(曲名だけだと別の版の画像になる)
  assert.match(queueSource, /queueEntry\.videoId === videoId/)
  assert.match(queueSource, /if \(next < sources\.length\) \{\s*rowImg\.src = sources\[next\+\+\];/)
})

test('動画モードの Loading... は帯の真ん中ではなく、最初の歌詞の行が来る所に歌詞と同じ揃えで出す', () => {
  const css = read('src/css/style.css')
  const wide = css.match(/body\.ytm-custom-layout\.ytm-movie-lyrics #my-lyrics-container\.moviemode \.lyric-loading \{([^}]*)\}/g)
  assert.ok(wide && wide.length === 2, '横長と縦長の 2 つ')
  assert.match(wide[0], /height: auto;/)
  assert.match(wide[0], /align-items: flex-end;/)
  assert.match(wide[0], /padding: 0 20px 0 0 !important;/)
  assert.match(wide[1], /align-items: flex-start;/)
})
