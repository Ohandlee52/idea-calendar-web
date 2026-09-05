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
// 앱 버전 (배포할 때마다 올립니다 — 폰이 새 코드를 받았는지 확인용)
const APP_VERSION = '1.6.1';

const conf = readConfig();
const configured = !!conf;
const sb = configured ? window.supabase.createClient(conf.url, conf.key) : null;

// 화면 요소
const $ = (id) => document.getElementById(id);
const loginView = $('loginView'), mainView = $('mainView'), editView = $('editView');
const loginEmail = $('loginEmail'), loginPw = $('loginPw'), loginMsg = $('loginMsg');
const monthLabel = $('monthLabel'), daysGrid = $('daysGrid');
const calendarWrap = $('calendarWrap'), topTitleBtn = $('topTitle'), topTitleText = $('topTitleText');
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
// 달력은 3단이다: 주간(기본) → 월간 → 연간 → 다시 주간.
// 이 앱은 달력이 아니라 메모장이므로 기본은 가장 좁은 주간이다.
let calMode = 'week';   // 'week' | 'month' | 'year'
// 일괄 삭제용 선택. id 만 담는다.
const selectedIds = new Set();
// 고정 메모는 기본 8개까지만 타일로 보여 준다. 나머지는 눌러서 펼친다.
let pinnedExpanded = false;
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
  watchRemote();          // 다른 기기에서 바뀌면 바로 가져오기
}

// ── 데이터 불러오기 / 저장 ──
// 데이터베이스의 항목 이름(snake_case)을 앱에서 쓰는 이름으로 바꿔줍니다.
// 서버 시각("...+00:00")과 앱 시각("...Z") 형식을 통일합니다.
// 안 그러면 같은 시각인데도 다르게 판단해 매번 전부 다시 올리게 됩니다.
function toIso(v) {
  if (!v) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function rowToMemo(r) {
  return {
    id: r.id, date: r.date, title: r.title || '', body: r.body || '',
    bodyHtml: r.body_html || '', tags: r.tags || [], pinned: !!r.pinned,
    reminders: Array.isArray(r.reminders) ? r.reminders : [],
    createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at),
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
  // 서버는 한 번에 최대 1000개만 주므로, 다 받을 때까지 나눠서 가져옵니다.
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('idea_memos')
      .select('*').eq('deleted', false)
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) { syncStatus.textContent = '⚠️ 불러오기 실패'; console.error(error); return; }
    rows.push(...(data || []));
    syncStatus.textContent = `불러오는 중… ${rows.length}개`;
    if (!data || data.length < PAGE) break;
  }
  allMemos = rows.map(rowToMemo);
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
/** 접힘 상태에서 보여줄 한 주(일~토)의 Date 7개 */
function weekOfSelected() {
  const base = selectedKey ? new Date(selectedKey + 'T00:00:00')
                           : new Date(viewYear, viewMonth, 1);
  const sunday = new Date(base);
  sunday.setDate(base.getDate() - base.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i); return d;
  });
}

function renderCalendar() {
  monthLabel.textContent = calMode === 'year'
    ? `${viewYear}년` : `${viewYear}년 ${viewMonth + 1}월`;
  calendarWrap.classList.toggle('collapsed', calMode === 'week');
  calendarWrap.classList.toggle('year-mode', calMode === 'year');
  topTitleBtn.setAttribute('aria-expanded', calMode === 'week' ? 'false' : 'true');
  topTitleBtn.dataset.mode = calMode;

  if (calMode === 'year') { renderYear(); return; }

  const countByDate = {}, reminderDates = new Set();
  for (const m of allMemos) {
    countByDate[m.date] = (countByDate[m.date] || 0) + 1;
    for (const r of (m.reminders || [])) if (!r.done) reminderDates.add(r.date);
  }
  const t = todayObj();
  daysGrid.innerHTML = '';

  // 접힘: 선택한 날짜가 든 주 7칸만. 펼침: 기존 월간 격자.
  const days = calMode === 'month'
    ? monthDays()
    : weekOfSelected().map((d) => ({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }));

  if (calMode === 'month') {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    for (let i = 0; i < firstDay; i++) {
      const b = document.createElement('div'); b.className = 'day blank';
      daysGrid.appendChild(b);
    }
  }

  for (const item of days) {
    const { y, m: mo, d } = item;
    const key = dateKey(y, mo, d);
    const cell = document.createElement('div');
    cell.className = 'day';
    // 접힘 상태에서 이번 달이 아닌 날은 흐리게
    if (calMode === 'week' && mo !== viewMonth) cell.classList.add('other-month');
    const wd = new Date(y, mo, d).getDay();
    if (wd === 0) cell.classList.add('sun');
    if (wd === 6) cell.classList.add('sat');
    if (Holidays.getHoliday(key)) cell.classList.add('holiday');
    if (y === t.y && mo === t.m && d === t.d) cell.classList.add('today');
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

/** 펼침 상태에서 쓰는 이번 달 전체 날짜 */
function monthDays() {
  const lastDate = new Date(viewYear, viewMonth + 1, 0).getDate();
  return Array.from({ length: lastDate }, (_, i) => ({ y: viewYear, m: viewMonth, d: i + 1 }));
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

  // 체크칸은 카드 안 제목 앞에 작게 둔다.
  // 카드 밖에 두면 왼쪽에 기둥이 생겨 목록이 어수선해지고 카드도 좁아진다.
  // 보이는 크기는 작게 두되 손가락이 닿는 범위는 padding 으로 넓힌다.
  const check = document.createElement('button');
  check.className = 'memo-check';
  check.type = 'button';
  check.setAttribute('role', 'checkbox');
  const syncCheck = () => {
    const on = selectedIds.has(memo.id);
    check.classList.toggle('on', on);
    check.setAttribute('aria-checked', on ? 'true' : 'false');
    check.setAttribute('aria-label', on ? '선택 해제' : '선택');
    card.classList.toggle('picked', on);
  };
  check.addEventListener('click', (e) => {
    e.stopPropagation();       // 체크는 선택만. 메모를 열지 않는다
    selectedIds.has(memo.id) ? selectedIds.delete(memo.id) : selectedIds.add(memo.id);
    syncCheck();
    renderSelectBar();
  });
  card.querySelector('.c-title').prepend(check);

  card.addEventListener('click', () => openMemo(memo));
  syncCheck();
  return card;
}

const PIN_MAX = 8;   // 기본으로 보여 주는 고정 메모 개수

// 고정 메모 머리말. 8개가 넘으면 펼치기 단추가 붙는다.
function pinnedHead(total) {
  const h = document.createElement('div');
  h.className = 'section-title pin-head';
  h.innerHTML = '<span>📌 고정된 메모</span>';
  if (total > PIN_MAX) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'pin-more';
    more.textContent = pinnedExpanded ? '접기' : `＋${total - PIN_MAX}개 더`;
    more.addEventListener('click', () => { pinnedExpanded = !pinnedExpanded; renderList(); });
    h.appendChild(more);
  }
  return h;
}

// 고정 메모를 제목만 담은 작은 타일 격자로 그린다.
// 카드로 그리면 3개만으로도 화면 절반을 먹어 정작 오늘 메모가 안 보인다.
// 칸 수는 개수에 맞춘다: 4개까지는 한 줄, 5개부터는 두 줄로 나눈다.
function pinnedGrid(pinned) {
  const shown = pinnedExpanded ? pinned : pinned.slice(0, PIN_MAX);
  const cols = shown.length <= 4 ? shown.length : Math.ceil(shown.length / 2);
  const grid = document.createElement('div');
  grid.className = 'pin-grid';
  grid.style.gridTemplateColumns = `repeat(${Math.min(cols, 4)}, minmax(0, 1fr))`;

  for (const memo of shown) {
    const tile = document.createElement('div');
    tile.className = 'pin-tile';
    const bell = (memo.reminders || []).some((r) => !r.done) ? ' 🔔' : '';
    const title = memo.title.trim() || '(제목 없음)';
    tile.innerHTML = `<span class="pin-title">${Logic.escapeHtml(title)}${bell}</span>`;
    tile.title = title;

    // 고정 메모도 골라서 지울 수 있어야 한다. 체크칸을 모서리에 둔다.
    const check = document.createElement('button');
    check.className = 'memo-check';
    check.type = 'button';
    check.setAttribute('role', 'checkbox');
    const sync = () => {
      const on = selectedIds.has(memo.id);
      check.classList.toggle('on', on);
      check.setAttribute('aria-checked', on ? 'true' : 'false');
      check.setAttribute('aria-label', on ? '선택 해제' : '선택');
      tile.classList.toggle('picked', on);
    };
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedIds.has(memo.id) ? selectedIds.delete(memo.id) : selectedIds.add(memo.id);
      sync();
      renderSelectBar();
    });
    tile.appendChild(check);
    tile.addEventListener('click', () => openMemo(memo));
    sync();
    grid.appendChild(tile);
  }
  return grid;
}

function renderList() {
  memoList.innerHTML = '';

  if (searchQuery.trim()) {
    listTitle.textContent = '🔍 검색 결과';
    topTitleText.textContent = '검색 결과';
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
  // 상단 제목이 곧 날짜다. 앱 이름은 사용자가 이미 아는 정보라 자리를 내준다.
  topTitleText.textContent = `${m}월 ${d}일 (${wd})`;

  // 고정 메모는 날짜와 상관없이 항상 위에
  const pinned = Logic.sortForDay(allMemos.filter((x) => x.pinned));
  const items = Logic.sortForDay(
    allMemos.filter((x) => x.date === selectedKey && !x.pinned));

  if (pinned.length) {
    memoList.appendChild(pinnedHead(pinned.length));
    memoList.appendChild(pinnedGrid(pinned));
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

/** 접힘 상태에서 주 단위로 이동한다 */
function moveWeek(step) {
  const base = selectedKey ? new Date(selectedKey + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + step * 7);
  viewYear = base.getFullYear(); viewMonth = base.getMonth();
  selectDate(dateKey(base.getFullYear(), base.getMonth(), base.getDate()));
}

/** 주간 → 월간 → 연간 → 주간 순으로 돈다 */
function toggleCalendar() {
  calMode = calMode === 'week' ? 'month' : calMode === 'month' ? 'year' : 'week';
  renderCalendar();
}

/** 연간 달력 — 12개월을 한눈에. 메모가 있는 달은 진하게 표시한다. */
function renderYear() {
  const countByMonth = new Array(12).fill(0);
  for (const m of allMemos) {
    const [y, mo] = m.date.split('-').map(Number);
    if (y === viewYear) countByMonth[mo - 1]++;
  }
  const t = todayObj();
  daysGrid.innerHTML = '';
  for (let mo = 0; mo < 12; mo++) {
    const cell = document.createElement('button');
    cell.className = 'year-cell';
    if (viewYear === t.y && mo === t.m) cell.classList.add('today');
    if (mo === viewMonth) cell.classList.add('selected');
    cell.innerHTML = `<span class="ym">${mo + 1}월</span>` +
      (countByMonth[mo] ? `<span class="yc">${countByMonth[mo]}</span>` : '<span class="yc dim">·</span>');
    cell.addEventListener('click', () => {
      viewMonth = mo;
      calMode = 'month';       // 달을 고르면 월간으로 내려간다
      renderCalendar();
    });
    daysGrid.appendChild(cell);
  }
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

function stepHead(step) {
  if (calMode === 'year') { viewYear += step; renderCalendar(); }
  else moveMonth(step);
}
$('prevMonth').addEventListener('click', () => stepHead(-1));
$('nextMonth').addEventListener('click', () => stepHead(1));
$('todayBtn').addEventListener('click', goToday);
$('newMemoBtn').addEventListener('click', newMemo);
topTitleBtn.addEventListener('click', toggleCalendar);

// ── 바로 쓰기 ──
// 아이디어 메모장의 핵심 동선이다. 한 번 눌러 타이핑, 엔터로 저장. 화면 이동이 없다.
const quickInput = $('quickInput'), quickSave = $('quickSave');

function refreshQuickSave() {
  quickSave.classList.toggle('hidden', quickInput.value.trim() === '');
}

async function quickCommit() {
  const text = quickInput.value.trim();
  if (!text || !selectedKey) return;
  // 첫 줄을 제목으로 쓴다. 제목만 있는 메모가 아이디어 메모의 기본 형태다.
  const memo = {
    id: crypto.randomUUID(), date: selectedKey,
    title: text, body: '', bodyHtml: '', tags: [],
    pinned: false, reminders: [],
    createdAt: nowISO(), updatedAt: nowISO(),
  };
  quickInput.value = '';
  refreshQuickSave();
  allMemos = [memo, ...allMemos];
  renderCalendar(); renderList();
  const ok = await saveMemo(memo);
  if (!ok) {
    // 저장에 실패하면 조용히 넘기지 않는다. 되돌리고 입력값을 살려 준다.
    allMemos = Logic.removeById(allMemos, memo.id);
    renderCalendar(); renderList();
    quickInput.value = text;
    refreshQuickSave();
  }
}

quickInput.addEventListener('input', refreshQuickSave);
quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); quickCommit(); }
});
quickSave.addEventListener('click', quickCommit);

// ── 선택 삭제 ──
const selectBar = $('selectBar'), selectCount = $('selectCount');

function renderSelectBar() {
  const n = selectedIds.size;
  selectBar.classList.toggle('hidden', n === 0);
  selectCount.textContent = `${n}개 선택`;
  // 선택 중에는 새 메모 버튼을 숨긴다. 두 버튼이 겹쳐 잘못 눌리는 것을 막는다.
  $('newMemoBtn').style.display = n > 0 ? 'none' : '';
}

function clearSelection() {
  selectedIds.clear();
  renderSelectBar();
  renderList();
}

$('selectCancel').addEventListener('click', clearSelection);

$('selectDelete').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  if (!confirm(`메모 ${ids.length}개를 지울까요? 되돌릴 수 없습니다.`)) return;

  const targets = allMemos.filter((m) => ids.includes(m.id));
  syncStatus.textContent = '삭제 중…';
  let failed = 0;
  for (const m of targets) {
    const ok = await deleteMemo(m);
    if (!ok) failed++;
  }
  selectedIds.clear();
  renderSelectBar();
  renderCalendar(); renderList();
  // 일부만 지워졌으면 조용히 넘어가지 않는다
  syncStatus.textContent = failed
    ? `⚠️ ${targets.length - failed}개 삭제, ${failed}개 실패`
    : `${targets.length}개 삭제됨 ✓`;
});

// 상단바 높이를 재서 작성칸이 그 아래에 정확히 붙게 한다.
function syncHeadHeight() {
  const h = document.querySelector('#mainView .top-bar')?.getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty('--head-h', Math.round(h) + 'px');
}
window.addEventListener('resize', syncHeadHeight);
window.addEventListener('orientationchange', syncHeadHeight);
syncHeadHeight();

// 쓰다가 길어지면 전체 편집 화면으로 넘긴다. 친 내용은 그대로 가져간다.
$('quickExpand').addEventListener('click', () => {
  const text = quickInput.value.trim();
  quickInput.value = ''; refreshQuickSave();
  newMemo();
  if (text) { titleInput.value = text; }
});

// 달력을 좌우로 밀어 이동한다. 접힘이면 주 단위, 펼침이면 달 단위.
let swipeX = null, swipeY = null;
calendarWrap.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0]; swipeX = t.clientX; swipeY = t.clientY;
}, { passive: true });
calendarWrap.addEventListener('touchend', (e) => {
  if (swipeX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeX, dy = t.clientY - swipeY;
  swipeX = swipeY = null;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;  // 세로 스크롤과 헷갈리지 않게
  const step = dx < 0 ? 1 : -1;
  if (calMode === 'year') { viewYear += step; renderCalendar(); }
  else if (calMode === 'month') moveMonth(step);
  else moveWeek(step);
}, { passive: true });

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
$('menuBtn').addEventListener('click', () => {
  $('sheetTitle').textContent = `메뉴 · v${APP_VERSION}`;
  sheet.classList.remove('hidden');
});

// 앱을 최신 코드로 다시 받기 (저장해둔 파일을 지우고 새로 내려받습니다)
$('menuUpdate').addEventListener('click', async () => {
  sheet.classList.add('hidden');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { console.error(e); }
  alert('최신 버전을 받아옵니다. 화면이 다시 시작됩니다.');
  location.reload(true);
});
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

// ── 📥 PC 메모 가져오기 ──
// PC 앱의 데이터 파일(idea-calendar-data.json)이나 백업 파일을 골라
// 폰(Supabase)으로 올립니다. 같은 메모는 "수정 시각이 더 최신인 쪽"만 남깁니다.
$('menuImport').addEventListener('click', () => {
  sheet.classList.add('hidden');
  // 안내창을 거치면 브라우저가 파일 선택창을 막으므로, 곧바로 엽니다.
  $('importFile').click();
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                 // 같은 파일을 다시 고를 수 있게 초기화
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('파일을 읽지 못했어요.\n메모 파일(.json)이 맞는지 확인해 주세요.');
    return;
  }
  if (!data || !Array.isArray(data.memos)) {
    alert('메모 파일 형식이 아니에요.\nidea-calendar-data.json 또는 백업 파일을 골라주세요.');
    return;
  }

  // PC 앱의 옛 형식(reminderDate)도 새 형식(reminders)으로 맞춰줍니다.
  const incoming = data.memos.map((m) => {
    const reminders = Array.isArray(m.reminders) ? m.reminders.map((r) => ({
      id: String(r.id), date: String(r.date),
      time: typeof r.time === 'string' ? r.time : null, done: r.done === true,
    })) : [];
    if (typeof m.reminderDate === 'string' && m.reminderDate
        && !reminders.some((r) => r.date === m.reminderDate)) {
      reminders.push({ id: `${m.id}-r0`, date: m.reminderDate, time: null, done: m.reminderDone === true });
    }
    return {
      id: String(m.id), date: String(m.date),
      title: m.title || '', body: m.body || '', bodyHtml: m.bodyHtml || '',
      tags: Array.isArray(m.tags) ? m.tags : [],
      pinned: m.pinned === true, reminders,
      createdAt: m.createdAt || nowISO(), updatedAt: m.updatedAt || nowISO(),
    };
  });

  // 이미 폰에 있는 메모 중, 더 최신인 것은 덮어쓰지 않습니다.
  const mine = new Map(allMemos.map((m) => [m.id, m]));
  const toUpload = incoming.filter((m) => {
    const cur = mine.get(m.id);
    return !cur || m.updatedAt > cur.updatedAt;
  });

  if (toUpload.length === 0) {
    alert(`가져올 새 메모가 없어요.\n파일의 메모 ${incoming.length}개가 이미 모두 최신 상태입니다.`);
    return;
  }
  if (!confirm(`파일에서 메모 ${incoming.length}개를 찾았어요.\n`
    + `이 중 ${toUpload.length}개를 가져옵니다.\n\n`
    + '(이미 폰에 있는 더 최신 메모는 그대로 둡니다)\n계속할까요?')) return;

  // 한 번에 다 보내면 실패할 수 있어 100개씩 나눠 올립니다.
  syncStatus.textContent = '가져오는 중…';
  let done = 0;
  for (let i = 0; i < toUpload.length; i += 100) {
    const chunk = toUpload.slice(i, i + 100).map(memoToRow);
    const { error } = await sb.from('idea_memos').upsert(chunk);
    if (error) {
      console.error(error);
      alert(`${done}개까지 가져온 뒤 문제가 생겼어요.\n\n${error.message}`);
      break;
    }
    done += chunk.length;
    syncStatus.textContent = `가져오는 중… ${done}/${toUpload.length}`;
  }

  await loadMemos();
  renderCalendar(); renderList(); checkReminders();
  alert(`가져오기 완료 ✅\n메모 ${done}개를 가져왔어요.\n지금 총 ${allMemos.length}개입니다.`);
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

// ── 자동 새로고침 (PC에서 바뀐 메모를 알아서 가져옵니다) ──
let refreshing = false;
async function autoRefresh() {
  if (refreshing || !user) return;
  // 편집 화면에서 타이핑 중이면 방해하지 않습니다.
  if (!editView.classList.contains('hidden')) return;
  refreshing = true;
  try {
    await loadMemos();
    renderCalendar(); renderList(); checkReminders();
  } catch (e) { console.error('자동 새로고침 실패:', e); }
  finally { refreshing = false; }
}
// 폰 화면을 벗어날 때(앱 전환·화면 끄기) 쓰던 내용을 바로 저장합니다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && current && saveTimer) commitCurrent();
});

setInterval(autoRefresh, 60 * 1000);              // 1분마다
window.addEventListener('online', autoRefresh);   // 인터넷이 돌아오면

// 앱으로 돌아올 때 (폰에서 다른 앱 갔다 오면)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkReminders();
  autoRefresh();
});

// PC나 다른 기기에서 바뀌면 즉시 반영 (실시간 감지)
function watchRemote() {
  if (!sb || !user) return;
  try {
    sb.channel('idea_memos_watch_web')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'idea_memos', filter: `user_id=eq.${user.id}` },
        () => { setTimeout(autoRefresh, 1200); })
      .subscribe();
  } catch (e) {
    // 실시간 감지가 막혀 있어도 1분 주기 새로고침으로 동작합니다.
    console.error('실시간 감지 실패(주기 새로고침으로 대체):', e);
  }
}

// ── 연결 설정 화면 ──
function openSetup() {
  // 내 프로젝트 주소를 미리 채워둡니다 (다른 프로젝트를 쓰려면 고치면 돼요)
  $('setupUrl').value = localStorage.getItem('sbUrl')
    || 'https://bbqdyuvycumaxryyapbk.supabase.co';
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
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update();                                   // 새 버전 있는지 바로 확인
      // 새 버전이 준비되면 다음 실행 때 자동 적용되도록 합니다.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__reloadedForUpdate) { window.__reloadedForUpdate = true; location.reload(); }
      });
    } catch { /* 무시 */ }
  }

  if (!configured) { openSetup(); return; }   // 아직 연결 정보가 없으면 설정부터

  $('loginView').classList.remove('hidden');
  const { data } = await sb.auth.getSession();
  if (data.session) { user = data.session.user; await enterApp(); }
})();
