// ───────────────────────────────────────────────────────────────
//  아이디어 캘린더 - 순수 로직 (logic)
//  화면(DOM)이나 파일과 상관없는 "계산만 하는" 함수들입니다.
//  덕분에 자동 테스트(node --test)에서 이 함수들을 그대로 검사할 수 있어요.
//  화면(renderer.js)과 테스트가 똑같은 코드를 공유합니다.
// ───────────────────────────────────────────────────────────────
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;          // Node(테스트)에서 require 로 사용
  } else {
    root.Logic = api;              // 브라우저(화면)에서 window.Logic 으로 사용
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // 태그 문자열 "a, b ,,c" → ["a","b","c"]
  function parseTags(str) {
    return String(str).split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  }

  // 사용자 입력을 안전한 텍스트로 (HTML 태그가 실행되지 않게 함)
  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // 검색: 제목/본문/태그 중 하나라도 검색어를 포함하면 참 (대소문자 무시)
  function matchMemo(memo, query) {
    const q = String(query).trim().toLowerCase();
    if (q === '') return false;
    return memo.title.toLowerCase().includes(q)
      || memo.body.toLowerCase().includes(q)
      || memo.tags.some((t) => t.toLowerCase().includes(q));
  }

  // 검색 결과 정렬 (원본을 건드리지 않고 새 배열 반환)
  //  - 'updated' : 최근 수정순
  //  - 'date'    : 날짜 최신순, 같은 날은 최근 수정순
  function sortForSearch(list, sortBy) {
    return [...list].sort((a, b) => {
      if (sortBy === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  // 날짜별 목록 정렬 (고정 먼저, 그다음 최근 수정순)
  function sortForDay(list) {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  // 삭제: 해당 id를 뺀 새 배열 반환
  function removeById(list, id) {
    return list.filter((m) => m.id !== id);
  }

  // ── 스캔한 글에서 날짜 찾기 ──
  // 지원 형태: "2026년 9월 12일", "2026.9.12", "2026-09-12", "9월 12일", "09.12(토)"
  // today는 "YYYY-MM-DD" (연도가 없는 날짜의 기준). 결과는 "YYYY-MM-DD" 또는 null.
  function findDateInText(text, today) {
    const s = String(text);
    const t = String(today);
    const baseYear = Number(t.slice(0, 4));

    function make(y, m, d) {
      if (m < 1 || m > 12 || d < 1 || d > 31) return null;
      const mm = String(m).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      // 실제 존재하는 날짜인지 확인 (예: 2월 30일 거르기)
      const chk = new Date(`${y}-${mm}-${dd}T00:00:00`);
      if (chk.getMonth() + 1 !== m || chk.getDate() !== d) return null;
      return `${y}-${mm}-${dd}`;
    }

    // 1) 연도가 있는 형태부터 (가장 확실)
    let m = s.match(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?/);
    if (m) {
      const r = make(Number(m[1]), Number(m[2]), Number(m[3]));
      if (r) return r;
    }
    // 2) 연도 없는 "M월 D일"
    m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (!m) {
      // 3) "MM.DD(토)" 처럼 요일이 붙은 형태 (마침표/슬래시)
      m = s.match(/(\d{1,2})\s*[./]\s*(\d{1,2})\s*\(\s*[일월화수목금토]\s*\)/);
    }
    if (m) {
      const r = make(baseYear, Number(m[1]), Number(m[2]));
      if (r) {
        // 이미 한참(30일 이상) 지난 날짜면 내년 행사로 추정
        const diffDays = (new Date(r) - new Date(t)) / 86400000;
        if (diffDays < -30) {
          const next = make(baseYear + 1, Number(m[1]), Number(m[2]));
          if (next) return next;
        }
        return r;
      }
    }
    return null;
  }

  // ── 예약 알림: 지금 시각 기준으로 울려야 할 알림 찾기 ──
  // 메모마다 알림이 여러 개(reminders 배열) 있을 수 있습니다.
  // nowStamp는 "YYYY-MM-DDTHH:mm" (컴퓨터의 현지 시각).
  // 시간이 없는 알림(time=null)은 그 날이 되면 울리고,
  // 시간이 있는 알림은 그 시각이 지나야 울립니다.
  // 반환: [{ memo, rem }] 목록 (날짜·시간 순 정렬)
  function dueReminders(memos, nowStamp) {
    const today = String(nowStamp).slice(0, 10);
    const nowTime = String(nowStamp).slice(11, 16);
    const out = [];
    for (const memo of memos) {
      for (const rem of (memo.reminders || [])) {
        if (rem.done) continue;
        const due = rem.date < today
          || (rem.date === today && (!rem.time || rem.time <= nowTime));
        if (due) out.push({ memo, rem });
      }
    }
    out.sort((a, b) =>
      (a.rem.date + (a.rem.time || '')).localeCompare(b.rem.date + (b.rem.time || '')));
    return out;
  }

  // ── 글에서 인터넷 주소(URL) 찾기 ──
  // http(s)://... 와 www.... 형태를 찾습니다. 끝에 붙은 문장부호는 떼어냅니다.
  function extractUrls(text) {
    const found = String(text).match(/(?:https?:\/\/|www\.)[^\s<>"'()\[\]]+/gi) || [];
    const urls = [];
    for (let u of found) {
      u = u.replace(/[.,;:!?]+$/, '');            // 끝의 문장부호 제거
      if (/^www\./i.test(u)) u = 'https://' + u;  // www로 시작하면 https를 붙여줌
      if (!/^https?:\/\/.+\..+/i.test(u)) continue; // 주소답지 않으면 제외
      if (!urls.includes(u)) urls.push(u);        // 중복 제거
    }
    return urls;
  }

  // ── 글 속에서 "클릭한 위치(offset)"에 걸린 주소 찾기 ──
  // 내용칸에서 Ctrl+클릭한 자리가 주소 위라면 그 주소를 돌려줍니다.
  function urlAtOffset(text, offset) {
    const re = /(?:https?:\/\/|www\.)[^\s<>"'()\[\]]+/gi;
    const s = String(text);
    let m;
    while ((m = re.exec(s))) {
      let u = m[0].replace(/[.,;:!?]+$/, ''); // 끝의 문장부호는 주소가 아님
      const start = m.index;
      const end = start + u.length;
      if (offset >= start && offset <= end) {
        if (/^www\./i.test(u)) u = 'https://' + u;
        return /^https?:\/\/.+\..+/i.test(u) ? u : null;
      }
    }
    return null;
  }

  // ── 기간(시작~끝 날짜)에 속한 메모 고르기 ──
  function memosInRange(memos, from, to) {
    return memos.filter((m) => m.date >= from && m.date <= to);
  }

  // ── 글을 화면용 HTML로 바꾸며 주소에만 링크 표시(span)를 입히기 ──
  // 내용칸 뒤판(하이라이트)에 쓰입니다. 모든 글자는 escapeHtml로 안전 처리.
  function linkifyHtml(text) {
    const re = /(?:https?:\/\/|www\.)[^\s<>"'()\[\]]+/gi;
    const s = String(text);
    let html = '';
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      const raw = m[0];
      const trimmed = raw.replace(/[.,;:!?]+$/, ''); // 끝 문장부호는 링크 밖
      html += escapeHtml(s.slice(last, m.index));
      html += '<span class="hl-link">' + escapeHtml(trimmed) + '</span>';
      html += escapeHtml(raw.slice(trimmed.length));
      last = m.index + raw.length;
    }
    return html + escapeHtml(s.slice(last));
  }

  // ── 일정 파일(.ics) 만들기: 네이버/구글 캘린더에서 가져올 수 있는 표준 형식 ──
  // 메모 하나 = 그 날짜의 하루 종일 일정.
  // 시간이 정해진 알림(미확인)은 그 시각의 일정으로 추가합니다.
  function icsEscape(s) {
    return String(s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function memosToIcs(memos, nowIso) {
    const stamp = String(nowIso || '1970-01-01T00:00:00.000Z')
      .replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//IdeaCalendar//KO',
      'CALSCALE:GREGORIAN',
    ];
    for (const m of memos) {
      const title = m.title.trim() || '(제목 없음)';
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${m.id}@idea-calendar`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${m.date.replace(/-/g, '')}`);
      lines.push(`SUMMARY:${icsEscape(title)}`);
      if (m.body && m.body.trim()) lines.push(`DESCRIPTION:${icsEscape(m.body)}`);
      if (m.tags && m.tags.length) lines.push(`CATEGORIES:${icsEscape(m.tags.join(','))}`);
      lines.push('END:VEVENT');
      // 시간이 있는 미확인 알림 → 그 시각의 일정
      for (const r of (m.reminders || [])) {
        if (r.done || !r.time) continue;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${r.id}@idea-calendar`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`DTSTART:${r.date.replace(/-/g, '')}T${r.time.replace(':', '')}00`);
        lines.push(`SUMMARY:${icsEscape('🔔 ' + title)}`);
        lines.push('END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ── 일정 파일(.ics) 읽기: 네이버/구글 캘린더에서 내보낸 일정을 해석 ──
  // 반환: [{ uid, date:'YYYY-MM-DD', time:'HH:mm'|null, title, description }]
  // (반복 일정은 시작일 1건만 읽습니다)
  function icsUnescape(s) {
    return String(s)
      .replace(/\\n/gi, '\n').replace(/\\,/g, ',')
      .replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }
  function parseIcs(text) {
    // 긴 줄은 다음 줄 앞에 공백을 붙여 이어지는 규칙이라, 먼저 한 줄로 폅니다.
    const unfolded = String(text).replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    const events = [];
    let ev = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
      if (line === 'END:VEVENT') {
        if (ev && ev.date) {
          events.push({
            uid: ev.uid || `no-uid-${events.length}`,
            date: ev.date,
            time: ev.time || null,
            title: ev.title || '',
            description: ev.description || '',
          });
        }
        ev = null;
        continue;
      }
      if (!ev) continue;
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const head = line.slice(0, colon);      // 예: DTSTART;VALUE=DATE
      const value = line.slice(colon + 1);
      const name = head.split(';')[0].toUpperCase();

      if (name === 'UID') ev.uid = value.trim();
      else if (name === 'SUMMARY') ev.title = icsUnescape(value).trim();
      else if (name === 'DESCRIPTION') ev.description = icsUnescape(value).trim();
      else if (name === 'DTSTART') {
        const v = value.trim();
        let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
        if (m) {
          if (m[7] === 'Z') {
            // 세계표준시(UTC) → 이 컴퓨터의 현지 시각으로 변환
            const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
            const p = (n) => String(n).padStart(2, '0');
            ev.date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
            ev.time = `${p(d.getHours())}:${p(d.getMinutes())}`;
          } else {
            ev.date = `${m[1]}-${m[2]}-${m[3]}`;
            ev.time = `${m[4]}:${m[5]}`;
          }
        } else {
          m = v.match(/^(\d{4})(\d{2})(\d{2})$/); // 하루 종일 일정
          if (m) { ev.date = `${m[1]}-${m[2]}-${m[3]}`; ev.time = null; }
        }
      }
    }
    return events;
  }

  // ── OCR 결과 정리: 한글 낱글자 사이의 불필요한 띄어쓰기 제거 ──
  // 한글 OCR은 "결 혼 식 에"처럼 글자마다 띄는 경우가 많아요.
  // 그런 줄(한글 대부분이 낱글자로 띄어진 줄)만 골라 붙여줍니다.
  function cleanOcrLine(line) {
    const spacedPairs = line.match(/[가-힣] (?=[가-힣])/g) || [];
    const hangulChars = line.match(/[가-힣]/g) || [];
    if (hangulChars.length >= 4 && spacedPairs.length / hangulChars.length >= 0.4) {
      return line.replace(/([가-힣]) +(?=[가-힣])/g, '$1');
    }
    return line; // 정상적으로 띄어쓰기된 줄은 그대로 둠
  }
  function cleanOcrText(text) {
    return String(text).split(/\r?\n/).map(cleanOcrLine).join('\n');
  }

  // ── OCR 결과가 "읽을 만한 글"인지 판정 ──
  // 정상 글자(한글/영문/숫자/일반 문장부호/공백)가 아닌 잡글자의 비율을 잽니다.
  // 화면을 찍은 사진(물결무늬)이나 흐린 사진은 잡글자가 많이 나옵니다.
  function garbledRatio(text) {
    const s = String(text).replace(/\s/g, '');
    if (s.length === 0) return 1;
    const ok = s.match(/[가-힣A-Za-z0-9.,!?()~%:;'"&·\-–—_+*/=@#½〈〉《》「」『』〜ㆍ]/g) || [];
    return 1 - ok.length / s.length;
  }
  // 잡글자가 25%를 넘으면 "깨진 결과"로 봅니다.
  function looksGarbled(text) {
    return garbledRatio(text) > 0.25;
  }

  // ── 스캔한 글에서 제목 추천: 첫 번째 의미 있는 줄 (최대 30자) ──
  function suggestTitleFromText(text) {
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      const clean = line.replace(/\s+/g, ' ').trim();
      // 글자(한글/영문/숫자)가 2자 이상 들어간 줄만 제목 후보로
      const letters = clean.replace(/[^0-9A-Za-z가-힣]/g, '');
      if (letters.length >= 2) return clean.slice(0, 30);
    }
    return '스캔한 메모';
  }

  return {
    parseTags,
    escapeHtml,
    matchMemo,
    sortForSearch,
    sortForDay,
    removeById,
    findDateInText,
    suggestTitleFromText,
    cleanOcrText,
    garbledRatio,
    looksGarbled,
    dueReminders,
    memosToIcs,
    parseIcs,
    extractUrls,
    urlAtOffset,
    linkifyHtml,
    memosInRange,
  };
});
