// ───────────────────────────────────────────────────────────────
//  아이디어 캘린더 웹앱 (모바일)
//  · 로그인은 Supabase가 담당하고, 메모는 Supabase 데이터베이스에 저장됩니다.
//  · 검색·정렬·날짜 계산은 PC 앱과 똑같은 logic.js 를 함께 씁니다.
// ───────────────────────────────────────────────────────────────

// 연결 정보는 ① 이 기기에 저장해 둔 값 ② config.js 값 순으로 찾습니다.
// (파일을 고치지 않고도 폰에서 바로 입력할 수 있게 하기 위함)
function readConfig() {
  const saved = {
    url: localStorage.getItem('sbUrl') || '',
    key: localStorage.getItem('sbKey') || '',
  };
  if (saved.url && saved.key) return saved;
  const c = window.APP_CONFIG || {};
  if (c.SUPABASE_URL && !c.SUPABASE_URL.includes('여기에')) {
    return { url: c.SUPABASE_URL, key: c.SUPABASE_KEY };
  }
  return null;
}
const conf = readConfig();
const configured = !!conf;
const sb = configured ? window.supabase.createClient(conf.url, conf.key) : null;

// 화면 요소
const $ = (id) => document.getElementById(id);
const loginView = $('loginView'), mainView = $('mainView'), editView = $('editView');
const loginEmail = $('loginEmail'), loginPw = $('loginPw'), loginMsg = $('loginMsg');
const monthLabel = $('monthLabel'), daysGrid = $('daysGrid');
const listTitle = $('listTitle'), memoList = $('memoList'), syncStatus = $('syncStatus');
const searchBar = $('searchBar'), searchInput = $('searchInput');
const reminderBar = $('reminderBar');
const titleInput = $('memoTitle'), bodyInput = $('memoBody'), tagsInput = $('memoTags');
const linkRow = $('linkRow'), reminderRows = $('reminderRows');
const editDate = $('editDate'), editMeta = $('editMeta'), pinBtn = $('pinBtn');
const sheet = $('sheet');

// 상태
let user = null;
let allMemos = [];
let viewYear, viewMonth, selectedKey = null;
let current = null, currentIsNew = false;
let searchQuery = '';
let saveTimer = null;
const notifiedIds = new Set();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// ── 날짜 도우미 ──
const pad = (n) => String(n).padStart(2, '0');
function dateKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function todayObj() { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; }
function todayKey() { const t = todayObj(); return dateKey(t.y, t.m, t.d); }
function nowISO() { return new Date().toISOString(); }
function nowStamp() {
  const n = new Date();
  return `${dateKey(n.getFullYear(), n.getMonth(), n.getDate())}T${pad(n.getHours())}:${pad(n.getMinutes())}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 로그인 ──
function showLoginMsg(text, kind) {
  loginMsg.textContent = text;
  loginMsg.className = 'login-msg' + (kind ? ' ' + kind : '');
}

async function doLogin() {
  if (!sb) { showLoginMsg('연결 설정(config.js)이 아직 안 됐어요.', 'error'); return; }
  const email = loginEmail.value.trim();
  const password = loginPw.value;
  if (!email || !password) { showLoginMsg('이메일과 비밀번호를 입력해 주세요.', 'error'); return; }
  showLoginMsg('로그인 중…');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showLoginMsg(translateAuthError(error.message), 'error'); return; }
  user = data.user;
  await enterApp();
}

async function doSignup() {
  if (!sb) { showLoginMsg('연결 설정(config.js)이 아직 안 됐어요.', 'error'); return; }
  const email = loginEmail.value.trim();
  const password = loginPw.value;
  if (!email || password.length < 6) {
    showLoginMsg('이메일과 6자 이상 비밀번호를 입력해 주세요.', 'error'); return;
  }
  showLoginMsg('계정 만드는 중…');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { showLoginMsg(translateAuthError(error.message), 'error'); return; }
  if (data.session) { user = data.user; await enterApp(); }
  else showLoginMsg('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.', 'ok');
}

// 영어 오류 메시지를 알기 쉬운 한국어로
function translateAuthError(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes('invalid login')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (m.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (m.includes('email not confirmed')) return '메일함에서 가입 확인 링크를 먼저 눌러주세요.';
  if (m.includes('password')) return '비밀번호는 6자 이상이어야 해요.';
  if (m.includes('failed to fetch')) return '인터넷 연결을 확인해 주세요.';
  return `문제가 생겼어요: ${msg}`;
}

async function doLogout() {
  await sb.auth.signOut();
  user = null; allMemos = [];
  mainView.classList.add('hidden');
  editView.classList.add('hidden');
  loginView.classList.remove('hidden');
  showLoginMsg('');
}

async function enterApp() {
  loginView.classList.add('hidden');
  mainView.classList.remove('hidden');
  await loadMemos();
  goToday();
  checkReminders();
}

// ── 데이터 불러오기 / 저장 ──
// 데이터베이스의 항목 이름(snake_case)을 앱에서 쓰는 이름으로 바꿔줍니다.
function rowToMemo(r) {
  return {
    id: r.id, date: r.date, title: r.title || '', body: r.body || '',
    bodyHtml: r.body_html || '', tags: r.tags || [], pinned: !!r.pinned,
    reminders: Array.isArray(r.reminders) ? r.reminders : [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function memoToRow(m) {
  return {
    id: m.id, user_id: user.id, date: m.date, title: m.title, body: m.body,
    body_html: m.bodyHtml || null, tags: m.tags, pinned: m.pinned,
    reminders: m.reminders, deleted: false,
    created_at: m.createdAt, updated_at: m.updatedAt,
  };
}

async function loadMemos() {
  syncStatus.textContent = '불러오는 중…';
  const { data, error } = await sb.from('idea_memos')
    .select('*').eq('deleted', false).order('date', { ascending: false });
  if (error) { syncStatus.textContent = '⚠️ 불러오기 실패'; console.error(error); return; }
  allMemos = (data || []).map(rowToMemo);
  syncStatus.textContent = `메모 ${allMemos.length}개`;
}

async function saveMemo(memo) {
  syncStatus.textContent = '저장 중…';
  const { error } = await sb.from('idea_memos').upsert(memoToRow(memo));
  if (error) { syncStatus.textContent = '⚠️ 저장 실패'; console.error(error); return false; }
  syncStatus.textContent = '저장됨 ✓';
  return true;
}

async function deleteMemo(memo) {
  // 지운 표시만 남겨 다른 기기와 동기화해도 되살아나지 않게 합니다.
  const { error } = await sb.from('idea_memos')
    .update({ deleted: true, updated_at: nowISO() }).eq('id', memo.id);
  if (error) { console.error(error); return false; }
  allMemos = Logic.removeById(allMemos, memo.id);
  return true;
}

// ── 달력 ──
function renderCalendar() {
  monthLabel.textContent = `${viewYear}년 ${viewMonth + 1}월`;
  const countByDate = {}, reminderDates = new Set();
  for (const m of allMemos) {
    countByDate[m.date] = (countByDate[m.date] || 0) + 1;
    for (const r of (m.reminders || [])) if (!r.done) reminderDates.add(r.date);
  }
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
  const t = todayObj();
  daysGrid.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    const b = document.createElement('div'); b.className = 'day blank';
    daysGrid.appendChild(b);
  }
  for (let d = 1; d <= lastDate; d++) {
    const key = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement('div');
    cell.className = 'day';
    const wd = new Date(viewYear, viewMonth, d).getDay();
    if (wd === 0) cell.classList.add('sun');
    if (wd === 6) cell.classList.add('sat');
    if (Holidays.getHoliday(key)) cell.classList.add('holiday');
    if (viewYear === t.y && viewMonth === t.m && d === t.d) cell.classList.add('today');
    if (key === selectedKey) cell.classList.add('selected');

    const num = document.createElement('span');
    num.textContent = d;
    cell.appendChild(num);

    if (countByDate[key]) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      cell.appendChild(dot);
      const hol = Holidays.getHoliday(key);
      cell.title = (hol ? hol + ' · ' : '') + `메모 ${countByDate[key]}개`;
    }
    if (reminderDates.has(key)) {
      const bell = document.createElement('span');
      bell.className = 'bell'; bell.textContent = '🔔';
      cell.appendChild(bell);
    }
    cell.addEventListener('click', () => selectDate(key));
    daysGrid.appendChild(cell);
  }
}

function selectDate(key) {
  selectedKey = key;
  searchQuery = ''; searchInput.value = '';
  searchBar.classList.add('hidden');
  renderCalendar();
  renderList();
}

// ── 목록 ──
function memoCard(memo, showDate) {
  const card = document.createElement('div');
  card.className = 'memo-card';
  const pin = memo.pinned ? '📌 ' : '';
  const bell = (memo.reminders || []).some((r) => !r.done) ? ' 🔔' : '';
  const title = memo.title.trim() || '(제목 없음)';
  const snippet = memo.body.trim().slice(0, 60) || '(내용 없음)';
  card.innerHTML = `
    ${showDate ? `<div class="c-date">📅 ${Logic.escapeHtml(memo.date)}</div>` : ''}
    <div class="c-title">${pin}${Logic.escapeHtml(title)}${bell}</div>
    <div class="c-snippet">${Logic.escapeHtml(snippet)}</div>
    ${memo.tags.length ? `<div class="c-tags">${memo.tags.map((t) => `<span>#${Logic.escapeHtml(t)}</span>`).join('')}</div>` : ''}`;
  card.addEventListener('click', () => openMemo(memo));
  return card;
}

function renderList() {
  memoList.innerHTML = '';

  if (searchQuery.trim()) {
    listTitle.textContent = '🔍 검색 결과';
    const found = Logic.sortForSearch(
      allMemos.filter((m) => Logic.matchMemo(m, searchQuery)), 'date');
    if (found.length === 0) {
      memoList.innerHTML = '<div class="empty-state"><span class="emoji">🔍</span>검색 결과가 없어요.</div>';
      return;
    }
    for (const m of found) memoList.appendChild(memoCard(m, true));
    return;
  }

  if (!selectedKey) return;
  const [y, m, d] = selectedKey.split('-').map(Number);
  const wd = WEEK[new Date(y, m - 1, d).getDay()];
  const hol = Holidays.getHoliday(selectedKey);
  listTitle.textContent = `${m}월 ${d}일 (${wd})${hol ? ' · ' + hol : ''}`;

  // 고정 메모는 날짜와 상관없이 항상 위에
  const pinned = Logic.sortForDay(allMemos.filter((x) => x.pinned));
  const items = Logic.sortForDay(
    allMemos.filter((x) => x.date === selectedKey && !x.pinned));

  if (pinned.length) {
    const h = document.createElement('div');
    h.className = 'section-title'; h.textContent = '📌 고정된 메모';
    memoList.appendChild(h);
    for (const x of pinned) memoList.appendChild(memoCard(x, true));
    const h2 = document.createElement('div');
    h2.className = 'section-title'; h2.textContent = '🗓 이 날짜의 메모';
    memoList.appendChild(h2);
  }
  if (items.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty-state';
    e.innerHTML = pinned.length
      ? '이 날짜에는 메모가 없어요.'
      : '<span class="emoji">✍️</span>이 날짜에 메모가 없어요.<br>오른쪽 아래 ＋ 버튼으로 써보세요.';
    memoList.appendChild(e);
    return;
  }
  for (const x of items) memoList.appendChild(memoCard(x, false));
}

// ── 편집 화면 ──
function openEditView() { editView.classList.remove('hidden'); mainView.classList.add('hidden'); }
function closeEditView() { editView.classList.add('hidden'); mainView.classList.remove('hidden'); }

function openMemo(memo) {
  current = memo; currentIsNew = false;
  titleInput.value = memo.title;
  bodyInput.value = memo.body;
  tagsInput.value = memo.tags.join(', ');
  editDate.textContent = memo.date;
  editMeta.textContent = `수정 ${fmtDateTime(memo.updatedAt)}`;
  refreshEditControls();
  openEditView();
}

function newMemo() {
  if (!selectedKey) return;
  current = {
    id: crypto.randomUUID(), date: selectedKey,
    title: '', body: '', bodyHtml: '', tags: [],
    pinned: false, reminders: [],
    createdAt: nowISO(), updatedAt: nowISO(),
  };
  currentIsNew = true;
  titleInput.value = ''; bodyInput.value = ''; tagsInput.value = '';
  editDate.textContent = selectedKey;
  editMeta.textContent = '새 메모';
  refreshEditControls();
  openEditView();
  titleInput.focus();
}

function refreshEditControls() {
  if (!current) return;
  pinBtn.classList.toggle('on', current.pinned);
  pinBtn.textContent = current.pinned ? '📌 고정됨' : '📌 고정';
  renderReminderRows();
  renderLinkRow();
}

// 본문 속 주소를 눌러서 열 수 있는 버튼으로 (폰에서는 버튼이 누르기 편해요)
function renderLinkRow() {
  linkRow.innerHTML = '';
  const urls = Logic.extractUrls(`${titleInput.value}\n${bodyInput.value}`);
  for (const url of urls) {
    const a = document.createElement('button');
    a.className = 'link-btn';
    a.textContent = '🔗 ' + url.replace(/^https?:\/\//i, '');
    a.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
    linkRow.appendChild(a);
  }
}

function renderReminderRows() {
  reminderRows.innerHTML = '';
  if (!current) return;
  for (const rem of (current.reminders || [])) {
    const row = document.createElement('div');
    row.className = 'reminder-row';

    const dateIn = document.createElement('input');
    dateIn.type = 'date'; dateIn.value = rem.date;
    const timeIn = document.createElement('input');
    timeIn.type = 'time'; timeIn.value = rem.time || '';
    const status = document.createElement('span');
    status.className = 'r-status';
    status.textContent = rem.done ? '✅ 확인함' : '🔔 예약됨';
    const del = document.createElement('button');
    del.className = 'chip-btn r-del'; del.textContent = '✕';

    dateIn.addEventListener('change', () => {
      if (!dateIn.value) { dateIn.value = rem.date; return; }
      rem.date = dateIn.value; rem.done = false;
      notifiedIds.delete(rem.id); commitCurrent();
    });
    timeIn.addEventListener('change', () => {
      rem.time = timeIn.value || null; rem.done = false;
      notifiedIds.delete(rem.id); commitCurrent();
    });
    del.addEventListener('click', () => {
      current.reminders = current.reminders.filter((r) => r !== rem);
      renderReminderRows(); commitCurrent();
    });

    row.append(dateIn, timeIn, status, del);
    reminderRows.appendChild(row);
  }
}

// ── 자동 저장 ──
function scheduleSave() {
  syncStatus.textContent = '입력 중…';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(commitCurrent, 900);
}

async function commitCurrent() {
  if (!current) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const title = titleInput.value;
  const body = bodyInput.value;
  const tags = Logic.parseTags(tagsInput.value);
  const isEmpty = !title.trim() && !body.trim() && tags.length === 0;
  if (currentIsNew && isEmpty) return;   // 빈 메모는 저장하지 않음

  current.title = title; current.body = body; current.tags = tags;
  current.updatedAt = nowISO();
  if (currentIsNew) { allMemos.push(current); currentIsNew = false; }

  if (await saveMemo(current)) {
    editMeta.textContent = `수정 ${fmtDateTime(current.updatedAt)}`;
    renderCalendar(); renderList(); renderReminderBar();
  }
}

// ── 예약 알림 ──
function getDue() { return Logic.dueReminders(allMemos, nowStamp()); }

function renderReminderBar() {
  const due = getDue();
  if (due.length === 0) { reminderBar.classList.add('hidden'); reminderBar.innerHTML = ''; return; }
  reminderBar.classList.remove('hidden');
  reminderBar.innerHTML = `<div class="r-title">🔔 오늘의 알림 ${due.length}개</div>`;
  for (const { memo, rem } of due) {
    const item = document.createElement('div');
    item.className = 'r-item';
    const when = `${rem.date}${rem.time ? ' ' + rem.time : ''}`;
    item.innerHTML = `<span class="r-text"><b>${Logic.escapeHtml(memo.title.trim() || '(제목 없음)')}</b>
      <span style="color:var(--text-soft)"> · ${Logic.escapeHtml(when)}</span></span>
      <button class="r-done">확인</button>`;
    item.querySelector('.r-text').addEventListener('click', () => openMemo(memo));
    item.querySelector('.r-done').addEventListener('click', async () => {
      rem.done = true; memo.updatedAt = nowISO();
      await saveMemo(memo);
      renderReminderBar(); renderCalendar();
    });
    reminderBar.appendChild(item);
  }
}

function checkReminders() {
  renderReminderBar();
  const fresh = getDue().filter(({ rem }) => !notifiedIds.has(rem.id));
  if (fresh.length === 0) return;
  fresh.forEach(({ rem }) => notifiedIds.add(rem.id));
  // 폰 알림 (허용한 경우에만)
  if ('Notification' in window && Notification.permission === 'granted') {
    const { memo } = fresh[0];
    new Notification('🔔 아이디어 캘린더', {
      body: fresh.length === 1 ? (memo.title.trim() || '(제목 없음)')
        : `확인할 알림이 ${fresh.length}개 있어요.`,
    });
  }
}

// ── 달 이동 ──
function moveMonth(step) {
  viewMonth += step;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}
function goToday() {
  const t = todayObj();
  viewYear = t.y; viewMonth = t.m;
  selectDate(dateKey(t.y, t.m, t.d));
}

// ── 이벤트 연결 ──
$('loginBtn').addEventListener('click', doLogin);
$('signupBtn').addEventListener('click', doSignup);
loginPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

$('prevMonth').addEventListener('click', () => moveMonth(-1));
$('nextMonth').addEventListener('click', () => moveMonth(1));
$('todayBtn').addEventListener('click', goToday);
$('newMemoBtn').addEventListener('click', newMemo);

$('searchBtn').addEventListener('click', () => {
  searchBar.classList.toggle('hidden');
  if (!searchBar.classList.contains('hidden')) searchInput.focus();
});
$('searchClose').addEventListener('click', () => {
  searchBar.classList.add('hidden');
  searchQuery = ''; searchInput.value = ''; renderList();
});
searchInput.addEventListener('input', () => { searchQuery = searchInput.value; renderList(); });

titleInput.addEventListener('input', () => { scheduleSave(); renderLinkRow(); });
bodyInput.addEventListener('input', () => { scheduleSave(); renderLinkRow(); });
tagsInput.addEventListener('input', scheduleSave);

pinBtn.addEventListener('click', async () => {
  if (!current) return;
  current.pinned = !current.pinned;
  refreshEditControls();
  await commitCurrent();
});
$('addReminderBtn').addEventListener('click', async () => {
  if (!current) return;
  if (!Array.isArray(current.reminders)) current.reminders = [];
  current.reminders.push({ id: crypto.randomUUID(), date: current.date, time: null, done: false });
  renderReminderRows();
  await commitCurrent();
  // 폰 알림 권한을 아직 안 물어봤다면 여기서 물어봅니다.
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
});

$('editBack').addEventListener('click', async () => {
  await commitCurrent();
  closeEditView();
  renderCalendar(); renderList(); renderReminderBar();
});
$('editDelete').addEventListener('click', async () => {
  if (!current) return;
  if (currentIsNew) { closeEditView(); return; }
  const title = current.title.trim() || '(제목 없음)';
  if (!confirm(`"${title}" 메모를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
  await deleteMemo(current);
  current = null;
  closeEditView();
  renderCalendar(); renderList(); renderReminderBar();
});

// 메뉴
$('menuBtn').addEventListener('click', () => sheet.classList.remove('hidden'));
$('sheetClose').addEventListener('click', () => sheet.classList.add('hidden'));
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
$('menuSync').addEventListener('click', async () => {
  sheet.classList.add('hidden');
  await loadMemos();
  renderCalendar(); renderList(); checkReminders();
});
$('menuLogout').addEventListener('click', async () => {
  sheet.classList.add('hidden');
  if (confirm('로그아웃 할까요?')) await doLogout();
});
$('menuReport').addEventListener('click', () => {
  sheet.classList.add('hidden');
  openReport();
});

// ── 📄 모아보기 (이번 달 메모를 한 화면에) ──
function openReport() {
  const first = dateKey(viewYear, viewMonth, 1);
  const last = dateKey(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());
  const list = Logic.memosInRange(allMemos, first, last);
  if (list.length === 0) { alert(`${viewYear}년 ${viewMonth + 1}월에는 메모가 없어요.`); return; }

  const byDate = {};
  for (const m of list) (byDate[m.date] = byDate[m.date] || []).push(m);
  let body = '';
  for (const d of Object.keys(byDate).sort()) {
    const [y, mm, dd] = d.split('-').map(Number);
    const wd = WEEK[new Date(y, mm - 1, dd).getDay()];
    body += `<h2>${mm}월 ${dd}일 (${wd})</h2>`;
    for (const m of Logic.sortForDay(byDate[d])) {
      body += `<div class="memo"><div class="t">${m.pinned ? '📌 ' : ''}${Logic.escapeHtml(m.title.trim() || '(제목 없음)')}</div>
        ${m.tags.length ? `<div class="tags">${m.tags.map((t) => '#' + Logic.escapeHtml(t)).join(' ')}</div>` : ''}
        ${m.body.trim() ? `<div class="b">${Logic.linkifyHtml(m.body)}</div>` : ''}</div>`;
    }
  }
  const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>메모 모아보기 ${first} ~ ${last}</title><style>
body{font-family:system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;color:#2b2f38;
  max-width:700px;margin:0 auto;padding:20px 16px 60px;line-height:1.7}
h1{font-size:20px}.range{color:#6b7280;font-size:13px;margin-bottom:16px}
h2{font-size:15px;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #e5e7ef}
.memo{border:1px solid #e5e7ef;border-radius:10px;padding:10px 12px;margin-bottom:8px}
.t{font-weight:700}.tags{color:#5b6ef5;font-size:13px}
.b{white-space:pre-wrap;word-break:break-all;font-size:14px}
.hl-link{color:#3b82f6;text-decoration:underline}
</style></head><body><h1>💡 메모 모아보기</h1>
<div class="range">${first} ~ ${last} · 메모 ${list.length}개</div>${body}</body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else alert('팝업이 차단됐어요. 브라우저에서 팝업을 허용해 주세요.');
}

// 1분마다 알림 확인, 앱으로 돌아올 때도 확인
setInterval(checkReminders, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });

// ── 연결 설정 화면 ──
function openSetup() {
  $('setupUrl').value = localStorage.getItem('sbUrl') || '';
  $('setupKey').value = localStorage.getItem('sbKey') || '';
  $('setupView').classList.remove('hidden');
  $('loginView').classList.add('hidden');
  mainView.classList.add('hidden');
  editView.classList.add('hidden');
}
$('setupSave').addEventListener('click', () => {
  const url = $('setupUrl').value.trim().replace(/\/+$/, '');
  const key = $('setupKey').value.trim();
  if (!/^https:\/\/.+\.supabase\.co$/i.test(url)) {
    alert('Project URL을 확인해 주세요.\n예: https://abcdefgh.supabase.co'); return;
  }
  if (!key || key.length < 20) { alert('anon 공개키를 붙여넣어 주세요.'); return; }
  if (/service_role|sb_secret/i.test(key)) {
    alert('이건 비밀(secret) 키예요. 공개돼도 안전한 anon(publishable) 키를 넣어주세요.'); return;
  }
  localStorage.setItem('sbUrl', url);
  localStorage.setItem('sbKey', key);
  location.reload();   // 새 정보로 다시 시작
});
$('menuSetup').addEventListener('click', () => { sheet.classList.add('hidden'); openSetup(); });

// ── 시작 ──
(async function init() {
  // 서비스 워커 등록 (홈 화면 설치용)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (!configured) { openSetup(); return; }   // 아직 연결 정보가 없으면 설정부터

  $('loginView').classList.remove('hidden');
  const { data } = await sb.auth.getSession();
  if (data.session) { user = data.session.user; await enterApp(); }
})();
