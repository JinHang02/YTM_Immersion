// 曲が変わるたびの「動画 → 曲」強制切り替え。
//
// 以前は設定が無く、利用者が「動画」を選んでいても毎曲 .song-button を
// click していた(最大 10 回リトライ)。動画モードに留まる手段が無かった。
// 既定 ON = 今までどおりで、OFF にすれば動画モードを維持できる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')

test('既定は ON (今までの動き)', () => {
  assert.match(namespaceSource, /preferSongMode: true,/)
})

test('OFF なら切り替えない', () => {
  const start = uiSource.indexOf('function preferLyricsDefault(targetKey, attempt = 0) {')
  assert.notEqual(start, -1)
  const fn = uiSource.slice(start, uiSource.indexOf('\n}', start))
  assert.match(fn, /if \(!config\.preferSongMode\) return;/)
  // 打ち切りは click より先であること
  const guardAt = fn.indexOf('if (!config.preferSongMode) return;')
  const clickAt = fn.indexOf('songBtn.click()')
  assert.ok(guardAt !== -1 && clickAt !== -1 && guardAt < clickAt)
})

test('設定パネルに出て保存される', () => {
  assert.match(uiSource, /id="prefer-song-mode-toggle"/)
  assert.match(uiSource, /config\.preferSongMode = document\.getElementById\('prefer-song-mode-toggle'\)\.checked;/)
  assert.match(uiSource, /storage\.set\('ytm_prefer_song_mode', config\.preferSongMode\)/)
  assert.match(uiSource, /storage\.get\('ytm_prefer_song_mode'\)/)
})

test('4 言語ぶんの文言がある', () => {
  const hits = namespaceSource.match(/settings_prefer_song_mode: "/g) || []
  assert.equal(hits.length, 4)
})

// 読み込み直後のトグルは playback-mode が "NONE" のまま在り、少しして
// OMV_PREFERRED に決まる(実機)。"NONE" で諦めていたので、リンクから
// 開いたり読み込み直したりすると動画のまま残った
test('playback-mode が決まる前("NONE")は待ち、動画に決まったら「曲」へ切り替える', () => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  assert.ok(start !== -1 && end !== -1)
  const timers = []
  let clicks = 0
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'NONE',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const preferLyricsDefault = new Function('document', 'config', 'currentKey', 'setTimeout', 'MouseEvent',
    `${uiSource.slice(start, end + 2)}\nreturn preferLyricsDefault;`)(
    { querySelector: () => switcher, addEventListener: () => {} }, { preferSongMode: true }, 'song', (fn) => timers.push(fn), class { })
  preferLyricsDefault('song')
  assert.equal(clicks, 0)
  assert.equal(timers.length, 1, '"NONE" では待ち直す')
  timers.shift()()
  assert.equal(clicks, 0)
  switcher.mode = 'OMV_PREFERRED'
  timers.shift()()
  assert.equal(clicks, 1)
  // 曲に決まっていれば何もしない
  switcher.mode = 'ATV_PREFERRED'
  timers.length = 0
  preferLyricsDefault('song')
  assert.equal(timers.length, 0)
})

test('待っている間に利用者が自分で「動画」を押したら、その曲では「曲」へ押し戻さない', () => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  const timers = []
  let clicks = 0
  let onClick = null
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'NONE',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const doc = { querySelector: () => switcher, addEventListener: (type, fn) => { if (type === 'click') onClick = fn } }
  const preferLyricsDefault = new Function('document', 'config', 'currentKey', 'setTimeout', 'MouseEvent',
    `${uiSource.slice(start, end + 2)}\nreturn preferLyricsDefault;`)(
    doc, { preferSongMode: true }, 'song', (fn) => timers.push(fn), class { })
  preferLyricsDefault('song')
  assert.equal(timers.length, 1)
  // 拡張自身のクリック(isTrusted: false)は数えない
  onClick({ isTrusted: false, target: { closest: () => ({}) } })
  // 利用者が「動画」を押した
  onClick({ isTrusted: true, target: { closest: (sel) => (sel === 'ytmusic-av-toggle' ? {} : null) } })
  switcher.mode = 'OMV_PREFERRED'
  timers.shift()()
  assert.equal(clicks, 0, '押し戻した')
})

// MV は曲名・アーティストの書き方が曲版と違うことがある(日向坂46「君はハニーデュー」)。
// 「動画」を押すと曲のキーが変わり、別の曲と見なして「曲」へ押し戻していた(実機)
test('「動画」を押した直後にキーが変わっても押し戻さない。少し経ってからの曲替わりは今までどおり', () => {
  const start = uiSource.indexOf('let _userPlaybackModeKey')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  const timers = []
  let clicks = 0
  let onClick = null
  let now = 1000
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'ATV_PREFERRED',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const doc = { querySelector: () => switcher, addEventListener: (type, fn) => { if (type === 'click') onClick = fn } }
  const { preferLyricsDefault, setKey } = new Function('document', 'config', 'setTimeout', 'MouseEvent', 'Date', 'PREFER_SONG_MAX_ATTEMPTS',
    `let currentKey = 'song';\n${uiSource.slice(start, end + 2)}\nreturn { preferLyricsDefault, setKey: (k) => { currentKey = k } };`)(
    doc, { preferSongMode: true }, (fn) => timers.push(fn), class { }, { now: () => now }, 20)
  onClick({ isTrusted: true, target: { closest: (sel) => (sel === 'ytmusic-av-toggle' ? {} : null) } })
  switcher.mode = 'OMV_PREFERRED'
  now += 300
  setKey('mv')
  preferLyricsDefault('mv')
  assert.equal(clicks, 0, 'MV へ切り替えた直後に押し戻した')
  // キーは 1 回では落ち着かず、アーティスト名の書き方が行き来する(実機)
  now += 300
  setKey('mv///日向坂46')
  preferLyricsDefault('mv///日向坂46')
  now += 5000
  setKey('mv///Hinatazaka46')
  preferLyricsDefault('mv///Hinatazaka46')
  assert.equal(clicks, 0, 'アーティスト名の書き方が変わっただけで押し戻した')
  // その MV が終わって次の曲になったら、今までどおり「曲」へ
  now += 200000
  setKey('next')
  preferLyricsDefault('next')
  assert.equal(clicks, 1)
})
