// 動画モードの画質を YouTube のように選べるようにする
// (video-quality.js + page/quality-bridge.js + lyrics-ui.js のメニュー)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const bridgeSource = read('src/js/page/quality-bridge.js')
const moduleSource = read('src/js/module/video-quality.js')
const uiSource = read('src/js/module/lyrics-ui.js')
const css = read('src/css/style.css')
const manifest = JSON.parse(read('manifest.json'))

// ページ側の橋渡しを、偽のプレイヤーで動かす
const runBridge = ({ levels = ['hd1080', 'hd720', 'large', 'medium', 'auto'], videoId = 'v1' } = {}) => {
  const attrs = {}
  const listeners = {}
  const calls = []
  const player = {
    getAvailableQualityLevels: () => levels,
    getAvailableQualityData: () => levels.filter(q => q !== 'auto').map(q => ({ quality: q, qualityLabel: { hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p' }[q] || q, isPlayable: true })),
    getPlaybackQuality: () => 'hd720',
    getPlaybackQualityLabel: () => '720p',
    getVideoData: () => ({ video_id: state.videoId }),
    setPlaybackQualityRange: (a, b) => calls.push([a, b]),
  }
  const state = { videoId }
  const document = {
    documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v } },
    getElementById: (id) => (id === 'movie_player' ? player : null),
    addEventListener: (type, fn) => { listeners[type] = fn },
  }
  vm.runInNewContext(bridgeSource, { document })
  const want = (q) => { attrs['data-ytmi-quality-want'] = q; listeners['ytmi-quality-apply']() }
  return { attrs, listeners, calls, want, state }
}

test('選んだ画質にする。無ければそれより低い中で一番高いもの', () => {
  const b = runBridge()
  b.want('hd1080')
  assert.deepEqual(b.calls.at(-1), ['hd1080', 'hd1080'])
  b.want('hd1440')   // この動画は 1080p まで
  assert.deepEqual(b.calls.at(-1), ['hd1080', 'hd1080'])
  b.want('medium')
  assert.deepEqual(b.calls.at(-1), ['medium', 'medium'])
})

test('同じ動画に同じ画質を当て直さない。動画が変わったら当て直す', () => {
  const b = runBridge()
  b.want('hd720')
  b.listeners['playing']()
  b.listeners['playing']()
  assert.equal(b.calls.length, 1)
  b.state.videoId = 'v2'
  b.listeners['loadeddata']()
  assert.equal(b.calls.length, 2)
})

test('自動に戻す時、こちらで決めていなければ YouTube の画質に触らない', () => {
  const b = runBridge()
  b.want('auto')
  assert.equal(b.calls.length, 0)
  b.want('hd720')
  b.want('auto')
  assert.deepEqual(b.calls.at(-1), ['auto', 'auto'])
})

test('今の画質と選べる画質を <html> に書く', () => {
  const b = runBridge()
  b.listeners['ytmi-quality-read']()
  assert.equal(b.attrs['data-ytmi-quality'], 'hd720|720p|hd1080:1080p,hd720:720p,large:480p,medium:360p')
  assert.doesNotMatch(bridgeSource, /fetch\(|XMLHttpRequest|postMessage/)
})

test('拡張側: 選んだ画質は動画モードの間だけ当て、曲モードでは自動に戻す', async () => {
  const attrs = {}
  const events = []
  const saved = {}
  const ctx = {
    document: {
      documentElement: { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v } },
      dispatchEvent: (e) => events.push(e.type),
    },
    CustomEvent: class { constructor(type) { this.type = type } },
    storage: { get: async (k) => saved[k] ?? null, set: (k, v) => { saved[k] = v } },
  }
  vm.runInNewContext(`${moduleSource}\nthis.VQ = VideoQuality;`, ctx)
  ctx.VQ.setChoice('hd1080')
  assert.equal(saved.ytm_video_quality, 'hd1080')
  assert.equal(attrs['data-ytmi-quality-want'], 'auto')   // まだ曲モード
  ctx.VQ.sync(true)
  assert.equal(attrs['data-ytmi-quality-want'], 'hd1080')
  ctx.VQ.sync(false)
  assert.equal(attrs['data-ytmi-quality-want'], 'auto')
  assert.ok(events.every(t => t === 'ytmi-quality-apply'))
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.VQ._parse('hd720|720p|hd1080:1080p,hd720:720p'))), {
    current: 'hd720', label: '720p', levels: [{ quality: 'hd1080', label: '1080p' }, { quality: 'hd720', label: '720p' }],
  })
})

test('画質のボタンは動画モードの時だけ出て、メニューは歌詞ソースの表示より上に出る', () => {
  const iso = manifest.content_scripts.find(c => c.world !== 'MAIN')
  assert.ok(iso.js.indexOf('src/js/module/video-quality.js') < iso.js.indexOf('src/js/module/lyrics-ui.js'))
  assert.match(uiSource, /if \(typeof VideoQuality !== 'undefined'\) VideoQuality\.sync\(!!moviemode\);/)
  assert.match(uiSource, /if \(typeof VideoQuality !== 'undefined'\) VideoQuality\.sync\(false\);/)
  assert.match(uiSource, /void VideoQuality\.init\(\);/)
  assert.match(uiSource, /'ytm_video_quality',/)
  assert.match(css, /#ytm-btn-area:not\(\.moviemode\) \.ytm-quality-btn,/)
  assert.match(css, /#ytm-btn-area:has\(> \.ytm-upload-menu\.visible\) \{\s*z-index: 3000;/)
})
