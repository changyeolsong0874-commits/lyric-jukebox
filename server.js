// 가사 주크박스 - 의존성 없는 Node.js(18+) 서버. 실행: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MM_KEY = process.env.MUSIXMATCH_KEY || '';

// ---------- 가사 검색 ----------
const MOCK = [
  { title: 'Let It Be', artist: 'The Beatles', lyrics: 'whisper words of wisdom let it be' },
  { title: 'Imagine', artist: 'John Lennon', lyrics: 'imagine all the people living life in peace' },
  { title: 'Yesterday', artist: 'The Beatles', lyrics: 'yesterday all my troubles seemed so far away' },
  { title: 'Hello', artist: 'Adele', lyrics: 'hello from the other side' },
  { title: 'Someone Like You', artist: 'Adele', lyrics: 'never mind i ll find someone like you' },
  { title: 'Dynamite', artist: 'BTS', lyrics: 'cause i i i m in the stars tonight' },
  { title: 'Spring Day', artist: 'BTS', lyrics: 'bogo sipeunde jigeum manaro gaja' },
];

async function itunesPreview(title, artist) {
  const url = 'https://itunes.apple.com/search?media=music&entity=song&limit=1&term=' +
    encodeURIComponent(`${title} ${artist}`);
  const r = await fetch(url);
  const j = await r.json();
  const t = j.results && j.results[0];
  if (!t || !t.previewUrl) return null;
  return { previewUrl: t.previewUrl, cover: (t.artworkUrl100 || '').replace('100x100', '200x200') };
}

// 곡 제목/가수로 바로 검색 (키 불필요, 30초 미리듣기 있는 곡만)
async function itunesSearch(q, limit = 10) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=` + encodeURIComponent(q);
  const j = await (await fetch(url)).json();
  return (j.results || []).filter(t => t.previewUrl).map(t => ({
    id: crypto.randomUUID(), title: t.trackName, artist: t.artistName,
    previewUrl: t.previewUrl, cover: (t.artworkUrl100 || '').replace('100x100', '200x200'),
  }));
}

// 가사 검색 결과를 먼저, 그 뒤에 제목/가수 검색 결과를 붙이고 중복 제거
async function search(q) {
  const [byLyrics, byTitle] = await Promise.all([
    searchLyrics(q).catch(() => []),
    itunesSearch(q).catch(() => []),
  ]);
  const seen = new Set();
  return [...byLyrics, ...byTitle].filter(t => {
    const k = (t.title + '|' + t.artist).toLowerCase();
    return seen.has(k) ? false : seen.add(k);
  }).slice(0, 12);
}

async function searchLyrics(q) {
  let cands = [];
  if (MM_KEY) {
    const url = 'https://api.musixmatch.com/ws/1.1/track.search?page_size=6&s_track_rating=desc&f_has_lyrics=1' +
      `&q_lyrics=${encodeURIComponent(q)}&apikey=${MM_KEY}`;
    const j = await (await fetch(url)).json();
    cands = (j.message.body.track_list || []).map(x => ({
      title: x.track.track_name, artist: x.track.artist_name,
    }));
  } else {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    cands = MOCK.filter(m => words.every(w => m.lyrics.includes(w)));
  }
  const out = await Promise.all(cands.map(async c => {
    try {
      const p = await itunesPreview(c.title, c.artist);
      return p ? { id: crypto.randomUUID(), title: c.title, artist: c.artist, ...p } : null;
    } catch { return null; }
  }));
  return out.filter(Boolean);
}

// ---------- 방 상태 ----------
const rooms = new Map();
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { playlist: [], index: -1, playing: false, pos: 0, ref: Date.now(), clients: new Set() });
  return rooms.get(id);
}
const curPos = r => r.playing ? r.pos + (Date.now() - r.ref) : r.pos;
function snapshot(r) {
  return { playlist: r.playlist, index: r.index, playing: r.playing, pos: curPos(r), serverNow: Date.now(), users: r.clients.size };
}
function broadcast(r) {
  const data = `data: ${JSON.stringify(snapshot(r))}\n\n`;
  for (const res of r.clients) res.write(data);
}
function setPos(r, pos, playing) { r.pos = Math.max(0, pos); r.ref = Date.now(); r.playing = playing; }
function select(r, i) {
  if (i < 0 || i >= r.playlist.length) { r.index = r.playlist.length ? r.index : -1; setPos(r, 0, false); return; }
  r.index = i; setPos(r, 0, true);
}

function act(r, a) {
  switch (a.type) {
    case 'add':
      r.playlist.push(a.track);
      if (r.index === -1) select(r, 0);
      break;
    case 'remove': {
      const i = r.playlist.findIndex(t => t.id === a.id);
      if (i < 0) break;
      r.playlist.splice(i, 1);
      if (i < r.index) r.index--;
      else if (i === r.index) { r.index = r.playlist.length ? Math.min(i, r.playlist.length - 1) : -1; setPos(r, 0, r.index >= 0 && r.playing); }
      break;
    }
    case 'play': if (r.index === -1 && r.playlist.length) select(r, 0); else setPos(r, curPos(r), true); break;
    case 'pause': setPos(r, curPos(r), false); break;
    case 'seek': setPos(r, +a.pos || 0, r.playing); break;
    case 'select': select(r, +a.index); break;
    case 'next': select(r, r.index + 1 < r.playlist.length ? r.index + 1 : 0); break;
    case 'prev': select(r, r.index > 0 ? r.index - 1 : 0); break;
    case 'ended': // 여러 클라이언트가 동시에 보내도 한 번만 처리
      if (r.playlist[r.index] && r.playlist[r.index].id === a.id) {
        if (r.index + 1 < r.playlist.length) select(r, r.index + 1); else setPos(r, 0, false);
      }
      break;
  }
}

// ---------- HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/search') {
      const q = (u.searchParams.get('q') || '').trim();
      return json(res, 200, q ? await search(q) : []);
    }
    const m = u.pathname.match(/^\/api\/room\/([\w-]{1,32})\/(events|act|state)$/);
    if (m) {
      const r = getRoom(m[1]);
      if (m[2] === 'state') return json(res, 200, snapshot(r));
      if (m[2] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        r.clients.add(res);
        res.write(': ' + ' '.repeat(2048) + '\n\n'); // 프록시 버퍼를 밀어내기 위한 패딩
        res.write(`data: ${JSON.stringify(snapshot(r))}\n\n`);
        const ka = setInterval(() => res.write(': ka\n\n'), 20000);
        req.on('close', () => { clearInterval(ka); r.clients.delete(res); broadcast(r); });
        broadcast(r);
        return;
      }
      if (req.method !== 'POST') return json(res, 405, {});
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1e5) return json(res, 413, {}); }
      act(r, JSON.parse(body));
      broadcast(r);
      return json(res, 200, snapshot(r));
    }
    // 정적 파일
    const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[\\/])+/, ''));
    if (!f.startsWith(path.join(__dirname, 'public'))) return json(res, 403, {});
    fs.readFile(f, (e, d) => {
      if (e) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(d);
    });
  } catch (e) { json(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (가사 검색: ${MM_KEY ? 'Musixmatch' : 'mock 데이터 - MUSIXMATCH_KEY 미설정'})`));
