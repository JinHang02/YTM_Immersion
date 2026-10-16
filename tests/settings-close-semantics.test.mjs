// 設定パネルの「保存」と「閉じる」。
//
// 以前は閉じ方で結果が違った。
//   - UI サイズ・歌詞の太さ・背景の明るさは動かした時点で画面に出て、
//     保存せずに Esc や外側のクリックで閉じても戻らず、再読み込みで初めて戻った
//   - 翻訳のメイン/サブ・歌詞ソースの優先・表示言語のピルは、保存前から
//     config を書き換えていた(保存していない翻訳の言語が次の曲から使われた)
//   - トグルは閉じても画面に残り、次に開くと保存したように見えた
//   - 取得元のオン・オフ(差し込んだ許可ページ)はその場で保存されるのに、
//     今の曲の取り直しは親の「保存」を押した時だけだった
//
// 2026-10 から、設定は変えるたびに保存する(保存ボタンは無い。押し忘れて閉じると
// 変更が消え、保存の仕方が分かりにくいという声があった)。保存するたびに「閉じた時に
// 戻す基準」を今の値にそろえるので、閉じても何も戻らない。変えた直後(自動保存の
// 待ち)や保存の途中に閉じられた時は、捨てずに保存してから閉じる。
// 下の「保存せずに閉じると戻る」は、保存の処理が無い(開いただけの)時の動き。
// その場で保存される取得元の切り替えは、どの閉じ方でも閉じた時に反映する。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')

const between = (start, end) => {
  const from = ui.indexOf(start)
  assert.notEqual(from, -1, `見つからない: ${start}`)
  const to = ui.indexOf(end, from)
  assert.notEqual(to, -1, `見つからない: ${end}`)
  return ui.slice(from, to)
}

const lifecycle = between('const SETTINGS_LIVE_KEYS', '\n// ── 追加の歌詞サーバー')

const setup = ({ stored = {}, meta = { title: 'アイドル', artist: 'YOASOBI' } } = {}) => {
  const classes = new Set()
  const rootVars = new Map()
  const loads = []
  let renders = 0
  // PiP の背景は本体の明るさを写しているので、戻した時に写し直す
  const pipBrightnessSyncs = []
  const etcMenu = { style: { props: {}, setProperty(k, v) { this.props[k] = v } } }
  const config = {
    uiScale: 1, lyricWeight: '800', bgBrightness: undefined,
    mainLang: 'original', subLang: 'en', lyricSourceMode: 'ytm', uiLang: 'ja',
    disabledLyricSources: [],
  }
  const settings = {
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
  }
  const timers = []
  const context = vm.createContext({
    config,
    ui: { settings },
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: () => {},
    storage: { get: async (key) => (key in stored ? stored[key] : null) },
    DISABLED_LYRIC_SOURCES_KEY: 'ytm_disabled_lyric_sources',
    normalizeDisabledLyricSources: (v) => (Array.isArray(v) ? [...v] : []),
    initSettings: async () => {},
    renderSettingsPanel: () => { renders += 1 },
    applyUiScale: (v) => { config.uiScale = v; rootVars.set('--ytm-ui-scale', String(v)) },
    getMetadata: () => meta,
    loadLyrics: async (m) => { loads.push(m) },
    PipManager: { syncBackgroundBrightness: () => { pipBrightnessSyncs.push(rootVars.get('--ytm-bg-brightness')) } },
    document: {
      documentElement: {
        style: {
          setProperty: (k, v) => rootVars.set(k, v),
          removeProperty: (k) => rootVars.delete(k),
        },
      },
      getElementById: (id) => (id === 'ui-lang-etc-menu' ? etcMenu : null),
    },
  })
  vm.runInContext(`${lifecycle}\nthis.api = { openSettings, closeSettings, scheduleSettingsAutosave, get session() { return settingsSession } };`, context)
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }
  return { api: context.api, config, classes, rootVars, loads, flush, etcMenu, renders: () => renders, pipBrightnessSyncs, settings, timers }
}

test('開くたびに保存済みの値から描き直す', async () => {
  const env = setup()
  await env.api.openSettings()
  assert.equal(env.classes.has('active'), true)
  assert.equal(env.renders(), 1)
})

test('保存せずに閉じると、画面に出していた値も config も開いた時に戻る', async () => {
  const env = setup()
  await env.api.openSettings()
  // 保存前に動かした(スライダーとピルはこうして config と画面を書き換える)
  env.config.uiScale = 1.3
  env.config.lyricWeight = '400'
  env.config.mainLang = 'en'
  env.config.lyricSourceMode = 'wordsync'
  env.rootVars.set('--ytm-bg-brightness', '0.9')
  env.api.closeSettings()
  assert.equal(env.classes.has('active'), false)
  assert.equal(env.config.uiScale, 1)
  assert.equal(env.rootVars.get('--ytm-ui-scale'), '1')
  assert.equal(env.config.lyricWeight, '800')
  assert.equal(env.rootVars.get('--ytm-lyric-weight'), '800')
  assert.equal(env.config.mainLang, 'original')
  assert.equal(env.config.lyricSourceMode, 'ytm')
  // 保存したことの無い明るさは、既定(CSS の値)に戻す
  assert.equal(env.rootVars.has('--ytm-bg-brightness'), false)
  // PiP も戻した後の明るさで写し直す(動かした 0.9 のまま残さない)
  assert.deepEqual(env.pipBrightnessSyncs, [undefined])
  assert.equal(env.etcMenu.style.props.display, 'none', '表示言語の一覧が出たまま残る')
})

test('表示言語を切り替えたまま閉じたら、元の言語で描き直しておく', async () => {
  const env = setup()
  await env.api.openSettings()
  env.config.uiLang = 'en'
  env.api.closeSettings()
  assert.equal(env.config.uiLang, 'ja')
  assert.equal(env.renders(), 2)
})

test('保存して閉じた時は戻さない', async () => {
  const env = setup()
  await env.api.openSettings()
  env.config.uiScale = 1.3
  env.config.mainLang = 'en'
  env.api.closeSettings({ saved: true })
  assert.equal(env.config.uiScale, 1.3)
  assert.equal(env.config.mainLang, 'en')
  assert.equal(env.api.session, null)
})

test('取得元をその場で切り替えていたら、保存せずに閉じても今の曲を取り直す', async () => {
  const env = setup({ stored: { ytm_disabled_lyric_sources: ['lrclib'] } })
  await env.api.openSettings()
  env.api.closeSettings()
  await env.flush()
  assert.equal(env.loads.length, 1)
  assert.deepEqual([...env.config.disabledLyricSources], ['lrclib'])
})

test('追加の取得元(Chrome の許可)の切り替えも、知らせがあれば取り直す', async () => {
  const env = setup()
  await env.api.openSettings()
  env.api.session.sourcesChanged = true
  env.api.closeSettings()
  await env.flush()
  assert.equal(env.loads.length, 1)
})

test('何も切り替えていなければ取り直さない', async () => {
  const env = setup()
  await env.api.openSettings()
  env.api.closeSettings()
  await env.flush()
  assert.equal(env.loads.length, 0)
})

test('閉じる道はすべて closeSettings を通る', () => {
  // 歯車・× ・Esc・外側のクリック・iframe の中の Esc・保存
  assert.match(ui, /if \(ui\.settings\?\.classList\.contains\('active'\)\) closeSettings\(\);\s*else await openSettings\(\);/)
  assert.match(ui, /closeBtn\.onclick = \(ev\) => \{\s*ev\.stopPropagation\(\);\s*closeSettings\(\);/)
  assert.match(ui, /if \(ev\.key === 'Escape' && ui\.settings && ui\.settings\.classList\.contains\('active'\)\) \{\s*closeSettings\(\);/)
  assert.match(ui, /if \(pointerDownInSettings \|\| isInsideSettingsUi\(ev\.target\)\) return;[\s\S]{0,120}closeSettings\(\);/)
  assert.match(ui, /if \(data\.kind === 'escape'\) \{[\s\S]{0,120}closeSettings\(\);/)
  assert.match(ui, /closeSettings\(\{ saved: true \}\);/)
  // 直接 active を外している所が残っていない
  assert.equal((ui.match(/ui\.settings\.classList\.remove\('active'\)/g) || []).length, 1, 'closeSettings 以外で閉じている')
})

test('保存での取り直しの判定も、開いた時の状態と比べる', () => {
  const save = between('const commitSettings = async ({ close = false } = {}) => {', 'const translationChanged')
  assert.match(save, /const session = settingsSession;/)
  assert.match(save, /session\.sourcesChanged \|\|\s*session\.disabledSources !== disabledSourcesKey\(config\.disabledLyricSources\)/)
})

test('開いたまま描き直す時(表示言語の切り替え)は書きかけを引き継ぐ', () => {
  const render = between('function renderSettingsPanel() {', '\n  // 閉じるボタン')
  assert.match(render, /const draft = ui\.settings\.classList\.contains\('active'\) \? readSettingsDraft\(\) : null;/)
  assert.match(render, /if \(draft\) writeSettingsDraft\(draft\);/)
})

test('変えた直後(自動保存の待ち)に閉じたら、捨てずに保存してから閉じる', async () => {
  const env = setup()
  await env.api.openSettings()
  const commits = []
  env.settings._commitSettings = async (opts) => { commits.push(opts) }
  env.config.uiScale = 1.3
  env.api.scheduleSettingsAutosave()
  env.api.closeSettings()
  await env.flush()
  // 偽の環境(vm)の中で作られたオブジェクトなので、JSON で比べる
  assert.equal(JSON.stringify(commits), JSON.stringify([{ close: true }]))
  // 戻していない(保存の処理が閉じる)
  assert.equal(env.config.uiScale, 1.3)
})

test('保存ボタンは無く、変えたら自動で保存する', () => {
  assert.ok(!/save-settings-btn/.test(ui), '保存ボタンが残っている')
  assert.match(ui, /el\.matches\('\.settings-panel input'\) && el\.id !== 'settings-search'\) scheduleSettingsAutosave\(\);/)
  assert.match(ui, /ui\.settings\._commitSettings = commitSettings;/)
  // 開いたまま保存したら、閉じた時に戻す基準をそろえる
  assert.match(ui, /settingsSession\.snapshot = Object\.fromEntries\(SETTINGS_LIVE_KEYS\.map/)
})
