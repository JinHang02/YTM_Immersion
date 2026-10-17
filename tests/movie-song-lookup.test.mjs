// 動画モードの歌詞は、MV ではなく音源(曲版)で引く。
//
//   以前は歌詞サーバーへ MV の videoId と MV の長さ(<video>.duration)を送っていた。
//   MV はイントロや映像パートの分だけ長い(NewJeans「Ditto」は 82 秒)ので、長さで
//   照合する取得元(LrcLib・LyricsPlus・BuaaaBot・LiriQo など)は「歌詞が曲に足りない」と
//   弾き、videoId で引く取得元(LRCHub・SimpMusic)は MV の登録が無くて外れていた。
//   → 動画モードで同期歌詞が曲モードより少なかった。
//   ログイン状態の next の counterpart が音源(ATV)を指していれば、その videoId・曲名・
//   長さで引く。答えの照合(video_id)は MV のまま。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ytm = read('src/js/module/ytm-lyrics.js')
const ui = read('src/js/module/lyrics-ui.js')
const bg = read('src/js/background.js')

const slice = (src, startMark, endMark) => {
  const s = src.indexOf(startMark)
  assert.notEqual(s, -1, startMark)
  return src.slice(s, src.indexOf(endMark, s) + endMark.length)
}

const readSongCounterpart = new Function(`
  ${slice(ytm, 'const readQueueHead = (nextRes) => (', '\n  );')}
  ${slice(ytm, 'const runsText = (t) =>', ';')}
  ${slice(ytm, 'const parseLengthText = (s) => {', '\n  };')}
  ${slice(ytm, 'const musicVideoTypeOf = (item) => (', '\n  );')}
  ${slice(ytm, 'const readSongCounterpart = (nextRes, videoId) => {', '\n  };')}
  return readSongCounterpart;`)()

const item = (videoId, type, title, length) => ({
  videoId,
  title: { runs: [{ text: title }] },
  lengthText: { runs: [{ text: length }] },
  navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: `MUSIC_VIDEO_TYPE_${type}` } } } },
})
const nextRes = (primary, counterpart) => ({
  contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents: [{
    playlistPanelVideoWrapperRenderer: {
      primaryRenderer: { playlistPanelVideoRenderer: primary },
      ...(counterpart ? { counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: counterpart } }] } : {}),
    },
  }] } } } } } }] } } } },
})

test('MV を問い合わせた時: 音源の videoId・曲名・長さを返す', () => {
  const res = nextRes(item('MV', 'OMV', 'Ditto (Official MV)', '5:45'), item('SONG', 'ATV', 'Ditto', '3:06'))
  assert.deepEqual(readSongCounterpart(res, 'MV'), { videoId: 'SONG', title: 'Ditto', durationSec: 186 })
})

test('音源を再生中・counterpart が音源でない・別の動画の応答なら null', () => {
  assert.equal(readSongCounterpart(nextRes(item('SONG', 'ATV', 'Ditto', '3:06'), item('MV', 'OMV', 'Ditto', '5:45')), 'SONG'), null)
  assert.equal(readSongCounterpart(nextRes(item('MV', 'OMV', 'Ditto', '5:45'), item('X', 'UGC', 'Ditto', '3:06')), 'MV'), null)
  assert.equal(readSongCounterpart(nextRes(item('MV', 'OMV', 'Ditto', '5:45'), item('SONG', 'ATV', 'Ditto', '3:06')), 'OTHER'), null)
  assert.equal(readSongCounterpart(nextRes(item('MV', 'OMV', 'Ditto', '5:45'), null), 'MV'), null)
  assert.equal(readSongCounterpart({}, 'MV'), null)
})

test('長さが読めなければ durationSec は null(<video> の長さに戻る)', () => {
  const res = nextRes(item('MV', 'OMV', 'Ditto', '5:45'), item('SONG', 'ATV', 'Ditto', ''))
  assert.equal(readSongCounterpart(res, 'MV').durationSec, null)
})

test('対応表がある時だけ音源へ寄せる(音源の時刻の歌詞を MV の時刻へ直せる時だけ)', () => {
  const fn = slice(ui, 'const resolveMovieLookupSong = async (videoId) => {', '\n};')
  assert.match(fn, /YTMSegmentMap\.peek\(videoId\) \? song : null/)
  assert.match(fn, /isMoviePlaybackNow\(\)/)
})

test('答えの照合は MV の video_id のまま、引く先だけ lookup_video_id', () => {
  assert.match(ui, /if \(movieSong\) payload\.lookup_video_id = movieSong\.videoId;/)
  assert.match(ui, /duration_sec: durationSec,\s*youtube_url,\s*video_id,/)
  const get = slice(bg, "if (req.type === 'GET_LYRICS') {", "if (req.type === 'FIND_ALTERNATE_LYRICS') {")
  assert.match(get, /const lookupVideoId = lookup_video_id \|\| resolvedVideoId;/)
  // 取得元へ渡す videoId は全部 lookupVideoId
  assert.doesNotMatch(get, /video_id: resolvedVideoId(?! \|\|)/)
  assert.doesNotMatch(get, /fetchFromSimpMusic\(\{ video_id: resolvedVideoId/)
  // 返す答えの video_id は MV のまま
  assert.match(get, /video_id: resolvedVideoId \|\| null,/)
})
