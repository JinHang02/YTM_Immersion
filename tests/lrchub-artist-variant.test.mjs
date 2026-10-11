// LRCHub の曲名検索が、アーティスト名の表記違いで外れないこと。
//
// 実機: YTM の MediaSession のアーティスト名は曲(リリース)ごとに英字だったり
// 日本語だったりする。同じ日本語の画面でも、花鋏キョウの「Starry」は
// 「花鋏キョウ」、「Starry (night Remix)」は「Kyo Hanabasami」だった。
// LRCHub の登録が画面の表記(花鋏キョウ)だと、動画 ID で引けない時の
// 曲名検索(Starry / Kyo Hanabasami)が 0 件になり、単語同期が出なかった。
// 0 件の時だけ、画面の表記で一度引き直す。採るのは曲名が YTM の曲名
// そのものと同じレコードだけ(括弧を落とした「Starry」で探すので、
// 原曲を Remix に出さないため)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import * as API from '../src/js/module/api.js'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const bgSource = fs.readFileSync(new URL('../src/js/background.js', import.meta.url), 'utf8')

const record = (track, artist, id) => ({
  id,
  record_id: id,
  track,
  artist,
  lyrics: `[00:01.00]${track} line one\n[00:05.00]${track} line two`,
})

// /api/search だけを返す偽のサーバー。どの名前で何回探したかを数える
const withSearchServer = async (byArtist, fn) => {
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = new URL(String(url))
    if (u.pathname === '/api/search') {
      const artist = u.searchParams.get('artist') || ''
      calls.push({ track: u.searchParams.get('track'), artist })
      const candidates = byArtist[artist] || []
      return { ok: true, json: async () => ({ ok: true, count: candidates.length, candidates }) }
    }
    // 候補の詳細(/api/record)は引けないことにする。検索の本文で足りる
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = realFetch
  }
}

test('0 件なら画面の表記で引き直し、曲名が同じレコードを採る', async () => {
  await withSearchServer({
    '花鋏キョウ': [record('Starry (night Remix)', '花鋏キョウ', 'remix')],
  }, async (calls) => {
    const res = await API.fetchFromLrchubSearch({
      track: 'Starry', artist: 'Kyo Hanabasami', artist_alt: '花鋏キョウ', title_full: 'Starry (night Remix)',
    })
    assert.deepEqual(calls.map(c => c.artist), ['Kyo Hanabasami', '花鋏キョウ'])
    assert.match(res.lyrics, /Starry \(night Remix\) line one/)
    assert.deepEqual(res.candidates.map(c => c.record_id), ['remix'])
  })
})

test('引き直しでは、括弧を落とした曲名でしか合わない別の版(原曲)を採らない', async () => {
  await withSearchServer({
    '花鋏キョウ': [record('Starry', '花鋏キョウ', 'original')],
  }, async () => {
    const res = await API.fetchFromLrchubSearch({
      track: 'Starry', artist: 'Kyo Hanabasami', artist_alt: '花鋏キョウ', title_full: 'Starry (night Remix)',
    })
    assert.equal(res.lyrics, '')
    assert.deepEqual(res.candidates, [])
  })
})

test('最初の検索で候補があれば引き直さない(今までと同じ結果・同じ回数)', async () => {
  await withSearchServer({
    'Kyo Hanabasami': [record('Starry', 'Kyo Hanabasami', 'en')],
    '花鋏キョウ': [record('Starry', '花鋏キョウ', 'ja')],
  }, async (calls) => {
    const res = await API.fetchFromLrchubSearch({
      track: 'Starry', artist: 'Kyo Hanabasami', artist_alt: '花鋏キョウ', title_full: 'Starry',
    })
    assert.equal(calls.length, 1)
    assert.deepEqual(res.candidates.map(c => c.record_id), ['en'])
  })
})

test('引き直す名前が無い・同じ・曲名が分からない時は引き直さない', async () => {
  for (const extra of [
    {},
    { artist_alt: 'Kyo Hanabasami', title_full: 'Starry' },
    { artist_alt: '花鋏キョウ' },
  ]) {
    await withSearchServer({ '花鋏キョウ': [record('Starry', '花鋏キョウ', 'ja')] }, async (calls) => {
      const res = await API.fetchFromLrchubSearch({ track: 'Starry', artist: 'Kyo Hanabasami', ...extra })
      assert.equal(calls.length, 1, JSON.stringify(extra))
      assert.equal(res.lyrics, '')
    })
  }
})

// ── 画面の表記を読む側(lyrics-ui.js) ──────────────────────────
const loadVariant = (bar) => {
  const start = uiSource.indexOf('const ARTIST_SCRIPT_RE')
  const end = uiSource.indexOf('const extractVideoIdFromHref', start)
  assert.ok(start !== -1 && end !== -1)
  const context = vm.createContext({
    PLAYER_BAR_TITLE_SELECTOR: 'title',
    PLAYER_BAR_BYLINE_SELECTOR: 'byline',
    document: { querySelector: (sel) => (sel in bar ? { textContent: bar[sel] } : null) },
    parseBylineArtist: (text) => String(text || '').split('•')[0].trim(),
    normalizeTitleForSettle: (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''),
  })
  vm.runInContext(`${uiSource.slice(start, end)}\nthis.read = readShownArtistVariant;`, context)
  return context.read
}

test('画面の表記は、同じ曲で片方だけが日本語などの時だけ使う', () => {
  const bar = { title: 'Starry (night Remix)', byline: '花鋏キョウ • Horologium Florae • 2023年' }
  assert.equal(loadVariant(bar)({ title: 'Starry (night Remix)', artist: 'Kyo Hanabasami' }), '花鋏キョウ')
  // 韓国語も
  assert.equal(loadVariant({ title: 'Love wins all', byline: '아이유 • Love wins all' })({ title: 'Love wins all', artist: 'IU' }), '아이유')
  // バーに前の曲が残っている(曲送りの直後)
  assert.equal(loadVariant({ ...bar, title: 'Daisy' })({ title: 'Starry (night Remix)', artist: 'Kyo Hanabasami' }), '')
  // 同じ表記
  assert.equal(loadVariant({ ...bar, byline: 'Kyo Hanabasami • X' })({ title: 'Starry (night Remix)', artist: 'Kyo Hanabasami' }), '')
  // 両方英字(feat. の有無など、別の名義かもしれない)
  assert.equal(loadVariant({ title: 'Song', byline: 'A feat. B • X' })({ title: 'Song', artist: 'A' }), '')
  // 両方日本語
  assert.equal(loadVariant({ title: '曲', byline: '花鋏キョウ、獅子神レオナ • X' })({ title: '曲', artist: '花鋏キョウ' }), '')
  // バーが読めない
  assert.equal(loadVariant({})({ title: 'Starry', artist: 'Kyo Hanabasami' }), '')
})

test('LRCHub の曲名検索にだけ渡す(他の取得元・キャッシュのキーは今までどおり)', () => {
  assert.match(uiSource, /artist_alt: readShownArtistVariant\(meta\),\s*title_full: meta\.title \|\| '',/)
  // キャッシュのキーは MediaSession のまま
  assert.match(uiSource, /const thisKey = `\$\{meta\.title\}\/\/\/\$\{meta\.artist\}`;/)
  const code = bgSource.split('\n').filter(line => !line.includes('YTMLog.')).join('\n')
  const uses = code.split('artist_alt').length - 1
  // 受け取り 1 か所 + 曲名検索 2 か所(記録の行は除く)
  assert.equal(uses, 3)
  assert.equal(bgSource.split('API.fetchFromLrchubSearch({ track, artist, artist_alt, title_full,').length - 1, 2)
})
