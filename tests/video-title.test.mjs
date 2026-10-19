// 動画モードの曲名の整形(video-title.js)。
//
// 動画モードでは、動画のタイトル(「乃木坂46 『ごめんね ずっと･･･』Short Ver.」)が
// そのまま曲名の欄に出ていた。YT-Immersion の整形と同じ考えで曲名だけにする。
// 実機(隔離 Chrome)で確かめたこと:
//   - 乃木坂46『ごめんね ずっと･･･』Short Ver. の MV で、動画モードにすると
//     「ごめんね ずっと･･･」になり、曲モードに戻すと元のタイトルに戻る

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const source = read('src/js/module/video-title.js')
const ui = read('src/js/module/lyrics-ui.js')
const manifest = JSON.parse(read('manifest.json'))

const context = vm.createContext({})
vm.runInContext(`${source}\nthis.VideoTitle = VideoTitle;`, context)
const { formatTitle, cleanArtistName } = context.VideoTitle

test('『』「」と、前後が空白の \'\' の中身を曲名にする', () => {
  assert.equal(formatTitle('乃木坂46 『ごめんね ずっと･･･』Short Ver.', '乃木坂46'), 'ごめんね ずっと･･･')
  assert.equal(formatTitle('乃木坂46 「Route 246」 Best Shot Version.', 'NGZ46 Best Shot Channel 6'), 'Route 246')
  assert.equal(formatTitle('【MV】YOASOBI「夜に駆ける」', 'YOASOBI'), '夜に駆ける')
  assert.equal(formatTitle("NewJeans (뉴진스) 'Ditto' Official MV (Performance ver.1)", 'HYBE LABELS'), 'Ditto')
  // 中身が動画の種類だけなら曲名ではない
  assert.equal(formatTitle('夜に駆ける『MV』', 'YOASOBI'), '夜に駆ける')
})

test('括りが無い時は、アーティスト名と動画の種類を外す', () => {
  assert.equal(formatTitle('Rick Astley - Never Gonna Give You Up (Official Music Video)', 'Rick Astley'), 'Never Gonna Give You Up')
  assert.equal(formatTitle('YOASOBI 夜に駆ける MV', 'YOASOBI'), '夜に駆ける')
  assert.equal(formatTitle('Song (feat. Someone) [Official Video]', 'Artist'), 'Song (feat. Someone)')
  assert.equal(formatTitle("Michael Jackson - Don't Stop 'Til You Get Enough (Official Video)", 'Michael Jackson'), "Don't Stop 'Til You Get Enough")
})

test('曲名そのものは壊さない(語の中の mv・ful、曲名の Live、残すべき括弧、アポストロフィ)', () => {
  for (const title of ['僕たちのサヨナラ', 'Wonderful Life', 'Live Forever', 'Never Gonna Give You Up (2022 Remaster)', "Don't Stop 'Til You Get Enough", 'Lemmvy']) {
    assert.equal(formatTitle(title, 'Someone'), title)
  }
  // 全部消えてしまう時は元のまま
  assert.equal(formatTitle('MV', 'X'), 'MV')
  assert.equal(formatTitle('', 'X'), '')
})

test('チャンネル名の飾りを外す', () => {
  assert.equal(cleanArtistName('乃木坂46 OFFICIAL YouTube CHANNEL'), '乃木坂46')
  assert.equal(cleanArtistName('YOASOBIVEVO'), 'YOASOBI')
  assert.equal(cleanArtistName('Rich Brian'), 'Rich Brian')
})

test('動画モードの時だけ曲名の表示に使い、切り替えたら見直す。歌詞を探す曲名は元のまま', () => {
  const iso = manifest.content_scripts.find(c => c.world !== 'MAIN')
  assert.ok(iso.js.indexOf('src/js/module/video-title.js') < iso.js.indexOf('src/js/module/lyrics-ui.js'))
  assert.match(ui, /if \(typeof moviemode === 'undefined' \|\| moviemode !== true \|\| typeof VideoTitle === 'undefined'\) return title;\s*return VideoTitle\.formatTitle\(title, meta\.artist\);/)
  assert.match(ui, /_titleMeta = meta;\s*setTitleText\(ui\.title, shownTitleFor\(meta\)\);/)
  assert.match(ui, /moviemode = newMoviemode;\s*if \(changed\) refreshShownTitle\(\);/)
  assert.match(ui, /PipManager\.updateMeta\(shownTitleFor\(meta\),/)
})
