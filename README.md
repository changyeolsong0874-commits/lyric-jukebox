# 가사 주크박스

가사 일부 → 곡 검색 → 공유 재생목록 → 같은 방 사람들이 실시간 동기 재생 (30초 미리듣기).

## 실행
1. Node.js 18+ 설치 (https://nodejs.org)
2. `cd lyric-jukebox`
3. (선택) Musixmatch 키: `$env:MUSIXMATCH_KEY="발급키"` — 없으면 샘플 곡 7개(mock)로 동작
4. `node server.js` → http://localhost:3000
5. 같은 방 코드(또는 `?room=코드` 링크)로 여러 브라우저에서 접속

## 구조
- 가사 검색: Musixmatch `track.search(q_lyrics)` → 30초 음원은 iTunes Search API(키 불필요)
- 실시간: 서버 메모리의 방 상태를 SSE로 브로드캐스트, 동작은 POST. 위치는 서버 시각 기준으로 동기화
- 방 상태는 메모리에만 저장되어 서버 재시작 시 초기화됩니다.
