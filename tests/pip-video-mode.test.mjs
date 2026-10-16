// 動画モードの PiP。MV を captureStream で写して映し、歌詞は下に重ねる。
// YTM の video 要素は動かさない(動かすとプレイヤーが壊れる)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const pipSource = read('src/js/module/pip-manager.js')
const uiSource = read('src/js/module/lyrics-ui.js')

const fakeTrack = (kind) => ({ kind, readyState: 'live', stop() { this.readyState = 'ended' } })
const setup = (mode) => {
  const tracks = [fakeTrack('video'), fakeTrack('audio')]
  const stream = {
    getTracks: () => tracks.slice(),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    removeTrack: (t) => tracks.splice(tracks.indexOf(t), 1),
  }
  const listeners = {}
  const source = {
    captureStream: () => stream,
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type) => { delete listeners[type] },
  }
  const pipVideo = { srcObject: null, play: () => Promise.resolve() }
  const classes = new Set()
  const pipDoc = {
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
    getElementById: (id) => (id === 'pip-video' ? pipVideo : null),
  }
  const state = { moviemode: mode }
  const PipManager = new Function('document', 'console', 'state',
    `let moviemode; Object.defineProperty(state, 'set', { value: (v) => { moviemode = v } }); moviemode = state.moviemode;\n${pipSource}\nreturn PipManager;`)(
    { querySelector: () => source }, console, state)
  PipManager.pipWindow = { document: pipDoc }
  return { PipManager, state, tracks, pipVideo, classes, listeners }
}

test('動画モードなら MV の映像だけを写し、音の写しは止める', () => {
  const { PipManager, tracks, pipVideo, classes, listeners } = setup(true)
  PipManager.syncVideoMode()
  assert.ok(classes.has('ytm-pip-video'))
  assert.ok(pipVideo.srcObject)
  assert.deepEqual(tracks.map(t => t.kind), ['video'])
  assert.equal(typeof listeners.loadeddata, 'function', '曲が変わって映像が差し替わったら写し直す')
})

test('曲モードに戻ったら・PiP を閉じたら写しを止める', () => {
  const { PipManager, state, tracks, pipVideo, classes, listeners } = setup(true)
  PipManager.syncVideoMode()
  const video = tracks[0]
  state.set(false)
  PipManager.syncVideoMode()
  assert.ok(!classes.has('ytm-pip-video'))
  assert.equal(video.readyState, 'ended')
  assert.equal(pipVideo.srcObject, null)
  assert.equal(listeners.loadeddata, undefined)
  assert.match(pipSource, /addEventListener\('pagehide', \(\) => \{[\s\S]*?this\.detachVideo\(\);/)
})

test('動画モードで開く PiP は 16:9 の窓', () => {
  assert.match(pipSource, /videoMode\s*\? \{ width: 640, height: 360 \}/)
})

test('開いている PiP も、曲/動画の切り替えと曲替わりに付いてくる', () => {
  assert.match(uiSource, /moviemode = newMoviemode;[\s\S]{0,600}PipManager\.syncVideoMode\(\)/)
  assert.match(uiSource, /PipManager\.updateMeta\(meta\.title, \(ui\.artist && ui\.artist\.textContent\) \|\| meta\.artist\);\s*PipManager\.syncVideoMode\(\);/)
})
