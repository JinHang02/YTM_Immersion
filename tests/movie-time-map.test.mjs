// 動画モードの時刻合わせ(MV ⇔ 音源)。
//
//   - ログイン状態の next は、counterpart に「音源の何秒が MV の何秒か」の区間
//     (segmentMap.segment)を返す(ytm-lyrics.js の readSegmentInfo)。
//   - 歌詞の時刻は音源の時刻なので、MV の再生中はそれで直す(lyrics-ui.js)。
//     区間に入らない所は歌以外の場面(cut)。歌詞の行を押した時は逆向きに直して飛ぶ。
//   実測(YT-Immersion): NewJeans「Ditto」MV は音源の 0 秒 = MV の 82.035 秒。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ytm = read('src/js/module/ytm-lyrics.js')
const ui = read('src/js/module/lyrics-ui.js')

const slice = (src, startMark, endMark) => {
  const s = src.indexOf(startMark)
  assert.notEqual(s, -1, startMark)
  return src.slice(s, src.indexOf(endMark, s) + endMark.length)
}

const readSegmentInfo = new Function(`
  ${slice(ytm, 'const readQueueHead = (nextRes) => (', '\n  );')}
  ${slice(ytm, 'const readSegmentInfo = (nextRes, videoId) => {', '\n  };')}
  return readSegmentInfo;`)()

const nextRes = (primaryId, counterpartId, segs) => ({
  contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents: [{
    playlistPanelVideoWrapperRenderer: {
      primaryRenderer: { playlistPanelVideoRenderer: { videoId: primaryId } },
      counterpart: [{
        counterpartRenderer: { playlistPanelVideoRenderer: { videoId: counterpartId } },
        segmentMap: { segment: segs },
      }],
    },
  }] } } } } } }] } } } },
})
const seg = (p, c, d) => ({ primaryVideoStartTimeMilliseconds: String(p), counterpartVideoStartTimeMilliseconds: String(c), durationMilliseconds: String(d) })

test('MV を問い合わせた時: MV の秒 → 音源の秒', () => {
  const res = nextRes('MV', 'SONG', [seg(82035, 0, 100000), seg(200000, 100000, 50000)])
  assert.deepEqual(readSegmentInfo(res, 'MV'), [
    { videoStart: 82.035, songStart: 0, dur: 100 },
    { videoStart: 200, songStart: 100, dur: 50 },
  ])
})

test('問い合わせた動画が counterpart 側なら、向きを入れ替える', () => {
  const res = nextRes('SONG', 'MV', [seg(0, 82035, 100000)])
  assert.deepEqual(readSegmentInfo(res, 'MV'), [{ videoStart: 82.035, songStart: 0, dur: 100 }])
})

test('対応表が無い・別の動画の応答なら null', () => {
  assert.equal(readSegmentInfo(nextRes('MV', 'SONG', []), 'MV'), null)
  assert.equal(readSegmentInfo(nextRes('A', 'B', [seg(0, 0, 1000)]), 'MV'), null)
  assert.equal(readSegmentInfo({}, 'MV'), null)
})

const { movieToSongTime, songToMovieTime } = new Function(`
  ${slice(ui, 'const MOVIE_SEGMENT_EDGE', ';')}
  ${slice(ui, 'const movieToSongTime = (tv, segs) => {', '\n};')}
  ${slice(ui, 'const songToMovieTime = (ts, segs) => {', '\n};')}
  return { movieToSongTime, songToMovieTime };`)()

const segs = [
  { videoStart: 82.035, songStart: 0, dur: 100 },
  { videoStart: 200, songStart: 100, dur: 50 },
]

test('区間の中は音源の時刻に直す', () => {
  const m = movieToSongTime(92.035, segs)
  assert.equal(m.cut, false)
  assert.ok(Math.abs(m.time - 10) < 1e-9)
  assert.ok(Math.abs(movieToSongTime(210, segs).time - 110) < 1e-9)
})

test('イントロ・途中の映像パートは歌以外の場面(cut)で、次の区間を返す', () => {
  const intro = movieToSongTime(30, segs)
  assert.equal(intro.cut, true)
  assert.equal(intro.next.videoStart, 82.035)
  assert.ok(intro.time < 0.01)
  const mid = movieToSongTime(190, segs)
  assert.equal(mid.cut, true)
  assert.equal(mid.next.videoStart, 200)
  assert.ok(mid.time < 100 && mid.time > 99.9)
})

test('歌詞の行を押した時は、音源の時刻から MV の時刻へ戻す', () => {
  assert.ok(Math.abs(songToMovieTime(10, segs) - 92.035) < 1e-9)
  assert.ok(Math.abs(songToMovieTime(120, segs) - 220) < 1e-9)
  for (const t of [0.5, 42, 99, 101, 149]) {
    assert.ok(Math.abs(movieToSongTime(songToMovieTime(t, segs), segs).time - t) < 1e-9, `往復 ${t}`)
  }
})
