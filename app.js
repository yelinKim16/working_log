(() => {
  'use strict';

  // ───────── 상수 / 유틸 ─────────
  const KEY = 'worklog-data-v1';
  const PRI = {
    urgent: { label: '긴급', color: 'var(--urgent)', bg: 'var(--urgent-bg)' },
    high:   { label: '높음', color: 'var(--high)',   bg: 'var(--high-bg)' },
    normal: { label: '보통', color: 'var(--normal)', bg: 'var(--normal-bg)' },
    low:    { label: '낮음', color: 'var(--low)',    bg: 'var(--low-bg)' },
  };
  const PRI_ORDER = ['urgent', 'high', 'normal', 'low'];
  const COLORS = ['#e07ea3', '#f4a7b9', '#f6c28b', '#f3dd8e', '#9fd8b8', '#9cc5ee', '#b9a7ea', '#d6b4d9'];
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => fmt(new Date());
  const parseDay = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
  const dowOf = (ds) => parseDay(ds).getDay();
  const addDays = (ds, n) => { const d = parseDay(ds); d.setDate(d.getDate() + n); return fmt(d); };
  const short = (s) => { if (!s) return ''; const [, m, d] = s.split('-'); return `${+m}/${+d}`; };
  const stamp = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

  // 주 단위: 월요일 시작, 주차 이름은 그 주 목요일이 속한 달 기준 (예: 9/28~10/4 → 10월 1주차)
  const weekStart = (ds) => { const d = parseDay(ds); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); };
  const thisWeek = () => weekStart(today());
  const thursdayOf = (ws) => parseDay(addDays(ws, 3));
  const weekName = (ws) => { const th = thursdayOf(ws); return `${th.getMonth() + 1}월 ${Math.ceil(th.getDate() / 7)}주차`; };
  const weekRange = (ws) => `${short(ws)}~${short(addDays(ws, 6))}`;
  const weekLabel = (ws) => `${weekName(ws)} (${weekRange(ws)})`;
  const weekMonthKey = (ws) => fmt(thursdayOf(ws)).slice(0, 7);

  // 동기화 대상 내용 (보기 설정 등 PC별 설정은 제외)
  const contentOf = (d) => ({ unit: d.unit, user: d.user, projects: d.projects, days: d.days, tasks: d.tasks });
  const hashOf = (obj) => { const s = JSON.stringify(obj); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };

  // ───────── 데이터 ─────────
  // projects: 프로젝트 목록
  // days:     주간 업무일지 [{ date: 그 주 월요일, tabs: [{ id, projectId, label }] }]
  // tasks:    모든 Task — 주(date)·탭·프로젝트를 함께 가짐 (주간별/프로젝트별은 같은 Task를 다르게 보여주는 화면)
  function sampleData() {
    const d = sampleBase();
    d.sampleHash = hashOf(contentOf(d)); // 손대지 않은 예시 데이터인지 판별용
    return d;
  }
  function sampleBase() {
    const pid = uid(), td = thisWeek(), yd = addDays(td, -7), tab0 = uid(), tab1 = uid(), now = Date.now();
    return {
      unit: 'week',
      user: '',
      projects: [{ id: pid, name: 'TTA 인터페이스', color: COLORS[0], createdAt: now }],
      days: [{ date: td, tabs: [{ id: tab1, projectId: pid, label: '' }] }, { date: yd, tabs: [{ id: tab0, projectId: pid, label: '' }] }],
      tasks: [
        { id: uid(), date: td, tabId: tab1, projectId: pid, title: 'WebHook 확인', priority: 'urgent', due: '', done: false, notes: '', createdAt: now },
        { id: uid(), date: td, tabId: tab1, projectId: pid, title: '테스트 207 진행', priority: 'normal', due: addDays(today(), 3), done: false, createdAt: now,
          notes: '- [x] 테스트 환경 세팅 완료\n- [ ] 207-1 ~ 207-5 케이스 수행\n- [ ] 결과서 작성 후 공유\n담당자 확인 필요: 인증 토큰 만료 시간', notesAt: now },
        { id: uid(), date: yd, tabId: tab0, projectId: pid, title: '테스트 환경 세팅', priority: 'normal', due: '', done: true, notes: '', createdAt: now, doneAt: now },
      ],
      view: { type: 'day', date: td },
      ui: { summaryHidden: false, sortPriority: false, calMonth: td.slice(0, 7), months: {} },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 저장소 불가 → 샘플 */ }
    return sampleData();
  }

  // 예전 구조(체크리스트 안에 Task) → 새 구조(프로젝트 + 일자 + Task)
  function migrateV1(d) {
    d.projects = arr(d.lists).map((l) => ({ id: l.id, name: l.name, color: l.color, createdAt: Date.now() }));
    d.days = [];
    d.tasks = [];
    arr(d.lists).forEach((l) => arr(l.tasks).forEach((t) => {
      d.tasks.push({
        id: t.id || uid(), date: fmt(new Date(t.createdAt || Date.now())), tabId: null, projectId: l.id,
        title: t.title, priority: t.priority, due: t.end || t.start || '', done: !!t.done,
        notes: t.notes || '', notesAt: t.notesAt, createdAt: t.createdAt || Date.now(), doneAt: t.doneAt,
      });
    }));
    if (d.view?.type === 'list') d.view = { type: 'project', projectId: d.view.listId };
    d.__migrated = true;
  }
  // 하루 단위로 적던 데이터를 주 단위로 합침 (같은 주·같은 프로젝트·같은 메모의 탭은 하나로)
  function migrateToWeeks(d) {
    const tabMap = {}, weeks = {};
    [...arr(d.days)].sort((x, y) => (x.date < y.date ? -1 : 1)).forEach((day) => { // 먼저 쓴 날짜의 탭이 앞에 오도록
      if (!isDate(day.date)) return;
      const ws = weekStart(day.date);
      const w = (weeks[ws] ||= { date: ws, tabs: [] });
      arr(day.tabs).forEach((tab) => {
        let same = w.tabs.find((x) => x.projectId === tab.projectId && (x.label || '') === (tab.label || ''));
        if (!same) { same = { id: tab.id, projectId: tab.projectId, label: tab.label || '' }; w.tabs.push(same); }
        tabMap[tab.id] = same.id;
      });
    });
    d.days = Object.values(weeks);
    const tasks = arr(d.tasks).filter((t) => isDate(t.date));
    tasks.forEach((t) => {
      t.date = weekStart(t.date);
      if (t.tabId) t.tabId = tabMap[t.tabId] || null;
      if (t.carriedTo) t.carriedTo = weekStart(t.carriedTo);
      if (t.carriedFrom) t.carriedFrom = weekStart(t.carriedFrom);
    });
    // 같은 주 안에서 이월됐던 Task는 하나로 합침
    const drop = new Set();
    tasks.forEach((t) => {
      if (t.carriedFromId && t.carriedFrom === t.date) {
        const o = tasks.find((x) => x.id === t.carriedFromId);
        if (o && o.date === t.date) drop.add(o.id);
        delete t.carriedFrom; delete t.carriedFromId;
      }
    });
    d.tasks = tasks.filter((t) => !drop.has(t.id));
    d.tasks.forEach((t) => { if (t.carriedTo === t.date) delete t.carriedTo; });
    if (d.view?.type === 'day' && isDate(d.view.date)) d.view.date = weekStart(d.view.date);
    d.unit = 'week';
    d.__migrated = true;
  }
  function attachTab(d, t) {
    let day = d.days.find((x) => x.date === t.date);
    if (!day) { day = { date: t.date, tabs: [] }; d.days.push(day); }
    if (t.tabId && day.tabs.some((tb) => tb.id === t.tabId)) return;
    let tab = day.tabs.find((tb) => tb.projectId === t.projectId);
    if (!tab) { tab = { id: uid(), projectId: t.projectId, label: '' }; day.tabs.push(tab); }
    t.tabId = tab.id;
  }
  function normalize(d) {
    d = d || {};
    d.user = d.user || '';
    if (!Array.isArray(d.projects) && Array.isArray(d.lists)) migrateV1(d);
    if (d.unit !== 'week') migrateToWeeks(d);
    d.projects = arr(d.projects);
    d.days = arr(d.days).filter((x) => isDate(x.date));
    d.tasks = arr(d.tasks).filter((t) => isDate(t.date));
    d.projects.forEach((p) => { if (!p.color || p.color === '#16182b') p.color = COLORS[0]; });
    d.days.forEach((x) => { x.tabs = arr(x.tabs); });
    d.tasks.forEach((t) => {
      t.priority = PRI[t.priority] ? t.priority : 'normal';
      t.notes = t.notes || ''; t.due = t.due || '';
      attachTab(d, t);
    });
    d.days.sort((a, b) => (a.date < b.date ? 1 : -1));
    d.view = d.view || { type: 'home' };
    d.ui = Object.assign({ summaryHidden: false, sortPriority: false, calMonth: today().slice(0, 7), months: {} }, d.ui);
    d.ui.months = d.ui.months || {};
    delete d.lists; delete d.folders; delete d.app; delete d.schema; delete d.savedAt;
    return d;
  }

  let state = load();
  const tmp = { filter: 'all', editingNotes: null, expandedNotes: new Set(), flash: null, activeTab: {} };

  // 이 PC(브라우저)에 캐시로 저장 — 드라이브 연결이 끊겨도 작업은 유지됨
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('저장 실패: 브라우저 저장소를 사용할 수 없습니다'); }
  }
  function save() {
    saveLocal();
    Sync.markDirty();
  }
  const commit = () => { save(); render(); };
  const userName = () => state.user || Sync.meta.profile?.name || '사용자';

  const getProject = (id) => state.projects.find((p) => p.id === id);
  const projName = (id) => getProject(id)?.name || '(삭제된 프로젝트)';
  const projColor = (id) => getProject(id)?.color || '#ccc';
  const getDay = (date) => state.days.find((d) => d.date === date);
  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const tabTasks = (tabId) => state.tasks.filter((t) => t.tabId === tabId);
  const dayTasks = (date) => state.tasks.filter((t) => t.date === date);
  const projTasks = (pid) => state.tasks.filter((t) => t.projectId === pid);
  const isOverdue = (t) => !t.done && !t.carriedTo && t.due && t.due < today();

  function findTab(tabId) {
    for (const d of state.days) { const tab = d.tabs.find((t) => t.id === tabId); if (tab) return { day: d, tab }; }
    return null;
  }
  function ensureDay(date) {
    let d = getDay(date);
    if (!d) {
      d = { date, tabs: [] };
      state.days.push(d);
      state.days.sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    return d;
  }
  function addTab(date, projectId, label = '') {
    const tab = { id: uid(), projectId, label };
    ensureDay(date).tabs.push(tab);
    return tab;
  }
  function tabFor(date, projectId) {
    return ensureDay(date).tabs.find((t) => t.projectId === projectId) || addTab(date, projectId);
  }
  // Task 삭제 — 이월로 복사된 Task를 지우면 원본의 "이월됨" 표시도 되돌림
  function removeTasks(ids) {
    const set = new Set(ids);
    state.tasks.forEach((t) => {
      if (set.has(t.id) && t.carriedFromId) {
        const o = findTask(t.carriedFromId);
        if (o && !set.has(o.id)) delete o.carriedTo;
      }
    });
    state.tasks = state.tasks.filter((t) => !set.has(t.id));
  }
  function stats(tasks) {
    const by = {};
    PRI_ORDER.forEach((p) => (by[p] = { total: 0, done: 0 }));
    let done = 0, total = 0;
    tasks.forEach((t) => {
      if (t.carriedTo && !t.done) return; // 다음 날로 넘긴 Task는 진행률에서 제외
      total++; by[t.priority].total++;
      if (t.done) { by[t.priority].done++; done++; }
    });
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0, by };
  }
  // 가장 최근 주에서만 이전 주의 미완료 Task 가져오기를 제안
  function carryCandidates(date) {
    if (state.days.some((d) => d.date > date)) return [];
    return state.tasks.filter((t) => t.date < date && !t.done && !t.carriedTo);
  }

  // ───────── 렌더 ─────────
  function render() {
    if (Sync.locked()) { Sync.renderLogin(); return; }
    Sync.hideLogin();
    renderSidebar();
    renderMain();
  }

  function renderSidebar() {
    const v = state.view, tw = thisWeek();
    const byMonth = {};
    state.days.forEach((d) => (byMonth[weekMonthKey(d.date)] ||= []).push(d));
    const openMonth = v.type === 'day' ? weekMonthKey(v.date) : weekMonthKey(tw);
    const days = Object.keys(byMonth).sort().reverse().map((mk) => {
      const collapsed = state.ui.months[mk] ?? (mk !== openMonth && mk !== weekMonthKey(tw));
      const [y, m] = mk.split('-');
      return `<div class="month">
        <div class="month-head" data-action="toggle-month" data-m="${mk}"><span class="caret">${collapsed ? '▶' : '▼'}</span>${y}년 ${+m}월<span class="cnt">${byMonth[mk].length}</span></div>
        ${collapsed ? '' : byMonth[mk].map((d) => {
          const s = stats(dayTasks(d.date));
          return `<div class="nav-day ${v.type === 'day' && v.date === d.date ? 'active' : ''}" data-action="open-day" data-date="${d.date}">
            <span class="dd">${weekName(d.date).replace(/^\d+월 /, '')}</span><span class="dw">${weekRange(d.date)}</span>
            ${d.date === tw ? '<span class="today-pill">이번 주</span>' : ''}
            <span class="dots">${d.tabs.slice(0, 5).map((t) => `<i style="background:${projColor(t.projectId)}"></i>`).join('')}</span>
            <span class="grow"></span><span class="dc">${s.total ? `${s.done}/${s.total}` : ''}</span>
            <button class="icon-btn more" data-action="day-menu" data-date="${d.date}" title="더보기">⋯</button>
          </div>`;
        }).join('')}
      </div>`;
    }).join('') || '<div class="side-empty">+ 버튼으로 이번 주 업무일지를 시작하세요</div>';

    const projects = state.projects.map((p) => {
      const s = stats(projTasks(p.id));
      return `<div class="nav-list ${v.type === 'project' && v.projectId === p.id ? 'active' : ''}" data-action="open-project" data-id="${p.id}">
        <span class="dot" style="background:${p.color}"></span>
        <div class="nl-body">
          <div class="nl-name">${esc(p.name)}</div>
          <div class="nl-sub">${s.done}/${s.total} 완료</div>
          <div class="mini-bar"><span style="width:${s.pct}%"></span></div>
        </div>
        <button class="icon-btn more" data-action="project-menu" data-id="${p.id}" title="더보기">⋯</button>
      </div>`;
    }).join('') || '<div class="side-empty">+ 버튼으로 프로젝트를 만드세요</div>';

    $('#sidebar').innerHTML = `
      <div class="brand">
        <div class="brand-logo">✓</div>
        <div class="brand-name">근무일지</div>
        <button class="icon-btn" data-action="shortcuts" title="단축키">⌨</button>
      </div>
      <button class="search-btn" data-action="search">🔍 <span class="grow">검색...</span><kbd>Ctrl K</kbd></button>
      <div class="side-scroll">
        <div class="nav-item ${v.type === 'home' ? 'active' : ''}" data-action="go" data-view="home">🏠 홈</div>
        <div class="nav-item ${v.type === 'calendar' ? 'active' : ''}" data-action="go" data-view="calendar">📅 캘린더</div>
        <div class="side-sep"></div>
        <div class="side-label"><span>🗓 주간별</span><button class="icon-btn add" data-action="new-day" title="주 추가">+</button></div>
        ${days}
        <div class="side-sep"></div>
        <div class="side-label"><span>📁 프로젝트별</span><button class="icon-btn add" data-action="new-project" title="프로젝트 추가">+</button></div>
        ${projects}
      </div>
      <div class="side-foot">
        <div id="sync-status"></div>
        <div class="user-row">
          ${Sync.meta.profile?.picture ? `<img class="avatar" src="${esc(Sync.meta.profile.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar ph">${esc(userName().slice(0, 1))}</span>`}
          <div class="grow"><div class="uname">${esc(userName())}</div>${Sync.meta.profile?.email ? `<div class="umail">${esc(Sync.meta.profile.email)}</div>` : ''}</div>
          <button class="icon-btn" data-action="user-menu" title="설정">⋯</button>
        </div>
        <div class="foot-btns">
          <button class="dash-btn" data-action="new-day">+ 주</button>
          <button class="dash-btn" data-action="new-project">+ 프로젝트</button>
        </div>
      </div>`;
    Sync.render();
  }

  function mobileTop(title) {
    return `<div class="mobile-top"><button class="icon-btn" data-action="open-sidebar">☰</button>${esc(title)}</div>`;
  }

  function renderMain() {
    const v = state.view;
    const main = $('#main');
    if (v.type === 'day' && isDate(v.date)) main.innerHTML = dayView(v.date);
    else if (v.type === 'project' && getProject(v.projectId)) main.innerHTML = projectView(getProject(v.projectId));
    else if (v.type === 'calendar') main.innerHTML = calendarView();
    else main.innerHTML = homeView();

    if (tmp.editingNotes) {
      const ta = $('.notes-edit textarea', main);
      if (ta) { autoGrow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    if (tmp.flash) {
      const el = main.querySelector(`[data-task="${tmp.flash}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
      tmp.flash = null;
    }
  }

  // ── 공통 조각 ──
  function badgesOf(s) {
    return PRI_ORDER.map((p) => {
      const left = s.by[p].total - s.by[p].done;
      return left ? `<span class="badge" style="color:${PRI[p].color};background:${PRI[p].bg}">${PRI[p].label} ${left}</span>` : '';
    }).join('');
  }
  function headBlock({ dot, title, titleAction, extra = '', s, menu }) {
    return `<div class="list-head">
      <div class="list-title">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}
        <h1 ${titleAction || ''}>${title}</h1>${extra}<span class="grow"></span>${menu || ''}</div>
      <div class="head-row">
        <div class="badges">${badgesOf(s)}</div>
        <div class="head-progress">
          <div class="bar"><span style="width:${s.pct}%"></span></div>
          <div class="caption">${s.done} / ${s.total} 완료 · ${s.pct}%</div>
        </div>
      </div>
    </div>`;
  }
  function summaryBlock(s) {
    if (state.ui.summaryHidden) {
      return `<div class="summary" style="padding-top:10px;padding-bottom:10px"><div class="summary-top"><span class="label">요약</span><button class="link-btn" data-action="toggle-summary">펼치기 ▼</button></div></div>`;
    }
    const R = 42, C = 2 * Math.PI * R;
    return `<div class="summary">
      <div class="summary-top"><span class="label">요약</span><button class="link-btn" data-action="toggle-summary">숨기기 ▲</button></div>
      <div class="summary-body">
        <div class="donut">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--track)" stroke-width="7"/>
            <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--green)" stroke-width="7" stroke-linecap="round"
              stroke-dasharray="${(C * s.pct) / 100} ${C}" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="pct">${s.pct}%</div>
          <div class="frac">${s.done} / ${s.total}</div>
        </div>
        <div class="pri-rows">
          ${PRI_ORDER.map((p) => {
            const b = s.by[p], pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
            return `<div class="pri-row">
              <span class="name" style="color:${PRI[p].color}">${PRI[p].label}</span>
              <div class="bar"><span style="width:${pct}%;background:${PRI[p].color}"></span></div>
              <span class="n">${b.done}/${b.total}</span><span class="p">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }
  function toolbar() {
    const filters = [['all', '전체'], ...PRI_ORDER.map((p) => [p, PRI[p].label]), ['open', '미완료']];
    return `<div class="toolbar">
      ${filters.map(([k, label]) => `<button class="chip ${tmp.filter === k ? 'on' : ''}" data-action="filter" data-f="${k}">${label}</button>`).join('')}
      <span class="grow"></span>
      <button class="btn" data-action="excel">엑셀 다운로드</button>
      <button class="btn ${state.ui.sortPriority ? 'on' : ''}" data-action="sort">우선순위${state.ui.sortPriority ? ' ✓' : ''}</button>
      <button class="btn" data-action="share">공유</button>
      <button class="btn primary" data-action="add-task">+ Task 추가</button>
    </div>`;
  }
  function filterSort(tasks) {
    const list = tasks.filter((t) =>
      tmp.filter === 'all' ? true : tmp.filter === 'open' ? !t.done && !t.carriedTo : t.priority === tmp.filter);
    const idx = new Map(state.tasks.map((t, i) => [t.id, i]));
    const rank = (t) => (t.done ? 2 : t.carriedTo ? 1 : 0);
    return list.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (state.ui.sortPriority) {
        const d = PRI_ORDER.indexOf(a.priority) - PRI_ORDER.indexOf(b.priority);
        if (d) return d;
        if ((a.due || '9') !== (b.due || '9')) return (a.due || '9') < (b.due || '9') ? -1 : 1;
      }
      return idx.get(a.id) - idx.get(b.id);
    });
  }
  const priTag = (t) => `<span class="tag" style="color:${PRI[t.priority].color};background:${PRI[t.priority].bg}">${PRI[t.priority].label}</span>`;
  const dueTag = (t) => (t.due ? `<span class="tag date ${isOverdue(t) ? 'overdue' : t.done ? '' : 'plain'}">${isOverdue(t) ? '⚠ ' : ''}마감 ${short(t.due)}</span>` : '');

  function renderNotes(text) {
    return text.split('\n').map((line) => {
      let html = esc(line).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      if (/^\s*[-*] \[[xX]\]\s?/.test(line)) html = '<span class="nd">' + html.replace(/^\s*[-*] \[[xX]\]\s?/, '<span class="nb ck">☑</span>') + '</span>';
      else if (/^\s*[-*] \[ \]\s?/.test(line)) html = html.replace(/^\s*[-*] \[ \]\s?/, '<span class="nb">☐</span>');
      else if (/^\s*[-*•]\s/.test(line)) html = html.replace(/^\s*[-*•]\s/, '<span class="nb">•</span>');
      return html;
    }).join('\n');
  }

  function taskCard(t) {
    let notes = '';
    if (tmp.editingNotes === t.id) {
      notes = `<div class="notes-edit">
        <textarea data-notes="${t.id}" placeholder="비고를 자유롭게 적어주세요.&#10;- 글머리표&#10;- [ ] 할 일  /  - [x] 완료한 일">${esc(t.notes)}</textarea>
        <div class="hint"><span>자동 저장 · <kbd style="background:#eee;color:#666">Ctrl+Enter</kbd> 또는 <kbd style="background:#eee;color:#666">Esc</kbd>로 닫기</span>
        <button class="btn sm" data-action="close-notes">완료</button></div>
      </div>`;
    } else if (t.notes.trim()) {
      const long = t.notes.split('\n').length > 5 || t.notes.length > 320;
      const clamped = long && !tmp.expandedNotes.has(t.id);
      notes = `<div class="notes ${clamped ? 'clamped' : ''}" data-action="edit-notes" data-id="${t.id}" title="클릭하여 비고 수정">
        <div class="notes-text">${renderNotes(t.notes)}</div>
        ${long ? `<button class="more-toggle" data-action="toggle-expand" data-id="${t.id}">${clamped ? '더보기 ▼' : '접기 ▲'}</button>` : ''}
      </div>`;
    }
    return `<div class="task ${t.done ? 'done' : ''} ${t.carriedTo && !t.done ? 'carried' : ''}" data-task="${t.id}">
      <button class="check" data-action="toggle-task" data-id="${t.id}" aria-label="완료 표시">${t.done ? '✓' : ''}</button>
      <div class="task-title">${esc(t.title)}</div>
      <div class="tags">
        ${priTag(t)}${dueTag(t)}
        ${t.carriedFrom ? `<span class="tag carry-from">← ${weekName(t.carriedFrom)}에서 이월</span>` : ''}
        ${t.carriedTo ? `<span class="tag carry">→ ${weekName(t.carriedTo)}로 이월됨</span>` : ''}
      </div>
      ${notes}
      <div class="task-actions">
        <button class="t-act" data-action="edit-notes" data-id="${t.id}">📝 비고</button>
        <button class="t-act" data-action="edit-task" data-id="${t.id}">수정</button>
        <button class="t-act del" data-action="delete-task" data-id="${t.id}">삭제</button>
      </div>
    </div>`;
  }
  const emptyBox = (html) => `<div class="empty"><div class="big">📝</div>${html}</div>`;

  // ── 주간 화면 ──
  const ALL = '__all'; // "전체" 탭 — 그 주의 모든 탭 Task를 탭별로 묶어서 보여줌
  // 선택된 탭: 탭 객체, 전체 탭이면 ALL, 탭이 하나도 없으면 null
  function activeTabOf(date) {
    const day = getDay(date);
    if (!day || !day.tabs.length) return null;
    let id = tmp.activeTab[date] ?? ALL;
    if (id !== ALL && !day.tabs.some((t) => t.id === id)) id = ALL;
    tmp.activeTab[date] = id;
    return id === ALL ? ALL : day.tabs.find((t) => t.id === id);
  }
  const tabName = (t) => `${esc(projName(t.projectId))}${t.label ? `<span class="tl"> · ${esc(t.label)}</span>` : ''}`;
  function allTabsBody(day) {
    const groups = day.tabs.map((t) => {
      const all = tabTasks(t.id), list = filterSort(all), ts = stats(all);
      if (!list.length && tmp.filter !== 'all') return '';
      return `<div class="date-group">
        <div class="dg-head" data-action="select-tab" data-date="${day.date}" data-id="${t.id}" title="이 탭으로 이동">
          <span class="dot" style="background:${projColor(t.projectId)}"></span>
          <span class="dg-date">${tabName(t)}</span><span class="dg-cnt">${ts.done}/${ts.total} 완료</span>
          <span class="grow"></span><span class="dg-go">탭으로 이동 ›</span>
        </div>
        ${list.length ? list.map(taskCard).join('') : '<div class="group-empty">아직 Task가 없어요.</div>'}
      </div>`;
    }).join('');
    return groups || emptyBox('조건에 맞는 Task가 없습니다.');
  }
  function dayView(date) {
    const day = getDay(date) || { date, tabs: [] };
    const s = stats(dayTasks(date));
    const tab = activeTabOf(date);
    const carry = carryCandidates(date);
    const allTab = day.tabs.length ? `<div class="dtab all ${tab === ALL ? 'on' : ''}" data-action="select-tab" data-date="${date}" data-id="${ALL}">
        <span class="tn">전체</span><span class="tc">${s.done}/${s.total}</span></div>` : '';
    const tabs = allTab + day.tabs.map((t) => {
      const ts = stats(tabTasks(t.id));
      return `<div class="dtab ${tab && tab !== ALL && t.id === tab.id ? 'on' : ''}" data-action="select-tab" data-date="${date}" data-id="${t.id}">
        <span class="dot" style="background:${projColor(t.projectId)}"></span>
        <span class="tn">${tabName(t)}</span>
        <span class="tc">${ts.done}/${ts.total}</span>
        <button class="tab-more" data-action="tab-menu" data-date="${date}" data-id="${t.id}" title="탭 메뉴">⋯</button>
      </div>`;
    }).join('');

    let body;
    if (!tab) {
      body = emptyBox(`이 주에 아직 탭이 없어요.<br><b>+ 탭 추가</b>로 프로젝트를 골라 업무를 적어보세요.<br><br>
        <button class="btn primary" data-action="add-tab" data-date="${date}">+ 탭 추가</button>`);
    } else if (tab === ALL) {
      body = toolbar() + `<div class="tasks">${allTabsBody(day)}</div>`;
    } else {
      const all = tabTasks(tab.id), list = filterSort(all);
      body = toolbar() + `<div class="tasks">${list.length ? list.map(taskCard).join('')
        : emptyBox(all.length ? '조건에 맞는 Task가 없습니다.' : `아직 Task가 없어요.<br>오른쪽 위 <b>+ Task 추가</b>로 이번 주 업무를 적어보세요.`)}</div>`;
    }

    return `${mobileTop(weekLabel(date))}
      ${headBlock({
        title: esc(weekLabel(date)),
        extra: date === thisWeek() ? '<span class="today-pill big">이번 주</span>' : '',
        s,
        menu: getDay(date) ? `<button class="btn sm" data-action="day-menu" data-date="${date}">⋯ 주 메뉴</button>` : '',
      })}
      ${carry.length ? `<div class="carry-banner">📥 이전 주의 미완료 Task가 <b>${carry.length}개</b> 있어요.
        <button class="btn sm primary" data-action="carry" data-date="${date}">가져오기</button></div>` : ''}
      <div class="tabbar">${tabs}<button class="dtab add" data-action="add-tab" data-date="${date}">+ 탭 추가</button></div>
      ${body}`;
  }

  // ── 프로젝트별 화면 ──
  function projectView(p) {
    const all = projTasks(p.id), s = stats(all), list = filterSort(all);
    const dates = [...new Set(list.map((t) => t.date))].sort().reverse();
    const groups = dates.map((d) => {
      const items = list.filter((t) => t.date === d);
      const gs = stats(all.filter((t) => t.date === d));
      return `<div class="date-group">
        <div class="dg-head" data-action="open-day" data-date="${d}" data-project="${p.id}" title="이 주의 업무일지로 이동">
          <span class="dg-date">🗓 ${weekLabel(d)}</span>${d === thisWeek() ? '<span class="today-pill">이번 주</span>' : ''}
          <span class="dg-cnt">${gs.done}/${gs.total} 완료</span><span class="grow"></span><span class="dg-go">주간으로 이동 ›</span>
        </div>
        ${items.map(taskCard).join('')}
      </div>`;
    }).join('');
    return `${mobileTop(p.name)}
      ${headBlock({
        dot: p.color, title: esc(p.name), titleAction: `data-action="rename-project" data-id="${p.id}" title="클릭하여 이름 변경" class="editable"`, s,
        menu: `<button class="btn sm" data-action="project-menu" data-id="${p.id}">⋯ 프로젝트 메뉴</button>`,
      })}
      ${summaryBlock(s)}${toolbar()}
      <div class="tasks">${groups || emptyBox(all.length ? '조건에 맞는 Task가 없습니다.'
        : '이 프로젝트에 아직 Task가 없어요.<br>주간별 화면에서 이 프로젝트 탭을 추가하거나, 오른쪽 위 <b>+ Task 추가</b>를 눌러보세요.')}</div>`;
  }

  // ── 홈 ──
  function homeView() {
    const td = thisWeek();
    const ts = stats(dayTasks(td));
    const open = state.tasks.filter((t) => !t.done && !t.carriedTo);
    const overdue = state.tasks.filter(isOverdue);
    const urgent = open.filter((t) => t.priority === 'urgent' || t.priority === 'high');
    const todayOpen = dayTasks(td).filter((t) => !t.done && !t.carriedTo);
    const mini = (t) => `<div class="mini-task" data-action="goto-task" data-id="${t.id}">
        ${priTag(t)}<span class="t">${esc(t.title)}</span>${dueTag(t)}<span class="from">${esc(projName(t.projectId))} · ${weekName(t.date)}</span></div>`;
    const panel = (title, list, none) => `<div class="panel"><h2>${title}<span class="c">${list.length}</span></h2>
        ${list.length ? list.slice(0, 8).map(mini).join('') : `<div class="none">${none}</div>`}</div>`;
    const d = new Date();
    return `${mobileTop('홈')}
      <div class="page">
        <div class="home-top">
          <div><h1>안녕하세요, ${esc(userName())}님 👋</h1>
          <div class="sub">${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일</div></div>
          <button class="btn primary" data-action="start-today">${getDay(td) ? '이번 주 업무일지 열기 ›' : '+ 이번 주 업무일지 시작'}</button>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="k">이번 주 Task</div><div class="v">${ts.done}<small> / ${ts.total}</small></div></div>
          <div class="stat"><div class="k">전체 미완료</div><div class="v">${open.length}</div></div>
          <div class="stat"><div class="k">마감 지남</div><div class="v ${overdue.length ? 'red' : ''}">${overdue.length}</div></div>
          <div class="stat"><div class="k">프로젝트</div><div class="v">${state.projects.length}</div></div>
        </div>
        <div class="two-col">
          ${panel('📌 이번 주 할 일', todayOpen, '이번 주 남은 Task가 없어요.')}
          ${panel('🔥 긴급 · 높음', urgent, '긴급한 Task가 없습니다.')}
          ${panel('⚠ 마감 지남', overdue, '마감이 지난 Task가 없습니다.')}
          <div class="panel"><h2>🗓 최근 주간 업무일지<span class="c">${Math.min(state.days.length, 7)}</span></h2>
            ${state.days.slice(0, 7).map((dy) => {
              const s = stats(dayTasks(dy.date));
              return `<div class="mini-task" data-action="open-day" data-date="${dy.date}">
                <span class="t"><b>${weekLabel(dy.date)}</b> <span class="dots">${dy.tabs.map((t) => `<i style="background:${projColor(t.projectId)}"></i>`).join('')}</span></span>
                <span class="from">${s.done}/${s.total} 완료</span></div>`;
            }).join('') || '<div class="none">아직 업무일지가 없어요.</div>'}
          </div>
        </div>
        <div class="section-title">프로젝트</div>
        <div class="card-grid">
          ${state.projects.map((p) => {
            const s = stats(projTasks(p.id));
            const last = projTasks(p.id).map((t) => t.date).sort().pop();
            return `<div class="list-card" data-action="open-project" data-id="${p.id}">
              <div class="n"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</div>
              <div class="f">${last ? `최근 업무 ${weekLabel(last)}` : '아직 업무 없음'}</div>
              <div class="bar"><span style="width:${s.pct}%"></span></div>
              <div class="row"><span>${s.done}/${s.total} 완료</span><span>${s.pct}%</span></div>
            </div>`;
          }).join('') || '<div class="none" style="color:var(--muted)">프로젝트가 없습니다. 왼쪽 아래 <b>+ 프로젝트</b>로 만들어 보세요.</div>'}
        </div>
      </div>`;
  }

  // ── 캘린더 ──
  function calendarView() {
    const [y, m] = state.ui.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startDay = new Date(y, m - 1, 1 - first.getDay());
    const td = today();
    let cells = '';
    const tw = thisWeek();
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDay); d.setDate(startDay.getDate() + i);
      if (i === 35 && d.getMonth() !== m - 1) break;
      const ds = fmt(d), ws = weekStart(ds);
      const evs = state.tasks.filter((t) => t.due === ds).sort((a, b) => (a.done - b.done) || PRI_ORDER.indexOf(a.priority) - PRI_ORDER.indexOf(b.priority));
      cells += `<div class="cal-day ${d.getMonth() !== m - 1 ? 'out' : ''} ${ds === td ? 'today' : ''} ${ws === tw ? 'thisweek' : ''} ${getDay(ws) ? 'has' : ''} ${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}"
          data-action="open-day" data-date="${ws}" title="${weekLabel(ws)} 업무일지">
        <span class="dn">${d.getDate()}</span>
        ${evs.slice(0, 3).map((t) => `<div class="cal-ev ${t.done ? 'done' : ''}" style="background:${PRI[t.priority].bg};color:${PRI[t.priority].color}"
            data-action="goto-task" data-id="${t.id}" title="마감 · ${esc(projName(t.projectId))} · ${esc(t.title)}">${esc(t.title)}</div>`).join('')}
        ${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3}개</div>` : ''}
      </div>`;
    }
    return `${mobileTop('캘린더')}
      <div class="page">
        <div class="cal-head">
          <h1>${y}년 ${m}월</h1>
          <button class="btn sm" data-action="cal-move" data-d="-1">‹</button>
          <button class="btn sm" data-action="cal-move" data-d="0">오늘</button>
          <button class="btn sm" data-action="cal-move" data-d="1">›</button>
        </div>
        <div class="cal">
          <div class="cal-week">${DOW.map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('')}</div>
          <div class="cal-week">${cells}</div>
        </div>
        <div class="help" style="margin-top:10px">Task는 <b>마감일</b>에 표시돼요. 날짜 칸을 누르면 그 주의 업무일지로, Task를 누르면 해당 Task로 이동합니다.</div>
      </div>`;
  }

  // ───────── 모달 / 메뉴 / 토스트 ─────────
  function openModal(html, cls = '') {
    closeMenu();
    $('#modal-root').innerHTML = `<div class="modal-back" data-action="modal-back"><div class="modal ${cls}">${html}</div></div>`;
    const first = $('#modal-root [autofocus]') || $('#modal-root input, #modal-root textarea');
    if (first) first.focus();
    return $('#modal-root .modal');
  }
  const closeModal = () => { $('#modal-root').innerHTML = ''; };

  function askText(title, value = '', placeholder = '') {
    return new Promise((resolve) => {
      const m = openModal(`<h3>${esc(title)}</h3>
        <form><input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus autocomplete="off">
        <div class="modal-foot"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary">확인</button></div></form>`, 'sm');
      const inp = $('input', m); inp.select();
      $('form', m).onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); closeModal(); resolve(v); };
    });
  }
  function askDate(title, value = today(), ok = '확인') {
    return new Promise((resolve) => {
      const m = openModal(`<h3>${esc(title)}</h3>
        <form><input class="input" type="date" name="d" value="${value}" required autofocus>
        <div class="modal-foot"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary">${ok}</button></div></form>`, 'sm');
      $('form', m).onsubmit = (e) => { e.preventDefault(); const v = $('input', m).value; if (!isDate(v)) return; closeModal(); resolve(v); };
    });
  }
  function confirmDlg(msg, ok = '삭제') {
    return new Promise((resolve) => {
      const m = openModal(`<h3>확인</h3><div style="line-height:1.6">${msg}</div>
        <div class="modal-foot"><button class="btn" data-r="0">취소</button><button class="btn primary" data-r="1" autofocus>${ok}</button></div>`, 'sm');
      m.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { closeModal(); resolve(b.dataset.r === '1'); }));
    });
  }

  function newProject(name) {
    const p = { id: uid(), name, color: COLORS[state.projects.length % COLORS.length], createdAt: Date.now() };
    state.projects.push(p);
    return p;
  }

  // 탭 추가 / 프로젝트 변경 — 프로젝트 고르기 (새 프로젝트도 바로 만들 수 있음)
  function pickProjectModal({ title, current, label, withLabel, ok }) {
    return new Promise((resolve) => {
      const sel = current || state.projects[0]?.id || '__new';
      const m = openModal(`<h3>${esc(title)}</h3>
        <form>
          <div class="field"><label>프로젝트</label>
            <div class="proj-pick">
              ${state.projects.map((p) => `<label><input type="radio" name="pid" value="${p.id}" ${sel === p.id ? 'checked' : ''}>
                <span><i style="background:${p.color}"></i>${esc(p.name)}</span></label>`).join('')}
              <label class="new"><input type="radio" name="pid" value="__new" ${sel === '__new' ? 'checked' : ''}><span>+ 새 프로젝트</span></label>
            </div>
            <input class="input new-name" name="newName" placeholder="새 프로젝트 이름" autocomplete="off" style="margin-top:10px;${sel === '__new' ? '' : 'display:none'}">
          </div>
          ${withLabel ? `<div class="field"><label>탭 메모 (선택)</label>
            <input class="input" name="label" value="${esc(label || '')}" placeholder="같은 프로젝트 탭을 여러 개 쓸 때 구분용 · 예) 오전, 2차 테스트" autocomplete="off">
          </div>` : ''}
          <div class="modal-foot"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary">${ok}</button></div>
        </form>`, 'sm');
      const form = $('form', m), nn = $('.new-name', m);
      form.addEventListener('change', () => {
        const isNew = form.pid.value === '__new';
        nn.style.display = isNew ? '' : 'none';
        if (isNew) nn.focus();
      });
      if (sel === '__new') nn.focus();
      form.onsubmit = (e) => {
        e.preventDefault();
        let pid = form.pid.value;
        if (pid === '__new') {
          const name = nn.value.trim();
          if (!name) { nn.focus(); return; }
          pid = newProject(name).id;
        }
        closeModal();
        resolve({ projectId: pid, label: withLabel ? form.label.value.trim() : undefined });
      };
    });
  }

  // Task 추가/수정 — ctx: { date, tabId, projectId } (주간 탭), { date, chooseTab: true } (주간 전체 탭),
  //                      { projectId, askDate: true } (프로젝트별)
  function taskModal(task, ctx = {}) {
    const t = task || { title: '', priority: 'normal', due: '', notes: '' };
    const pid = task ? task.projectId : ctx.projectId;
    const dateTxt = task ? weekLabel(task.date) : ctx.date ? weekLabel(ctx.date) : '';
    const weekTabs = ctx.chooseTab ? getDay(ctx.date)?.tabs || [] : [];
    const m = openModal(`<h3>${task ? 'Task 수정' : 'Task 추가'}</h3>
      <div class="modal-sub">${pid ? `<span class="dot" style="background:${projColor(pid)}"></span>${esc(projName(pid))}` : ''}${dateTxt ? `${pid ? ' · ' : ''}${dateTxt}` : ''}</div>
      <form>
        ${!task && ctx.chooseTab ? `<div class="field"><label>탭 (프로젝트)</label>
          <div class="proj-pick">${weekTabs.map((tb, i) => `<label><input type="radio" name="tabId" value="${tb.id}" ${i === 0 ? 'checked' : ''}>
            <span><i style="background:${projColor(tb.projectId)}"></i>${esc(projName(tb.projectId))}${tb.label ? ` · ${esc(tb.label)}` : ''}</span></label>`).join('')}</div>
        </div>` : ''}
        <div class="field"><label>Task</label><input class="input" name="title" value="${esc(t.title)}" placeholder="예) 테스트 207 진행" autofocus autocomplete="off" required></div>
        <div class="field"><label>우선순위</label>
          <div class="seg">${PRI_ORDER.map((p) => `<label style="color:${PRI[p].color};--pbg:${PRI[p].bg}"><input type="radio" name="priority" value="${p}" ${t.priority === p ? 'checked' : ''}><span>${PRI[p].label}</span></label>`).join('')}</div>
        </div>
        <div class="row2">
          ${!task && ctx.askDate ? `<div class="field"><label>주 (날짜를 고르면 그 주로 들어가요)</label><input class="input" type="date" name="date" value="${today()}" required></div>` : ''}
          <div class="field"><label>마감일 (선택)</label><input class="input" type="date" name="due" value="${t.due || ''}"></div>
        </div>
        <div class="field"><label>비고</label>
          <textarea name="notes" placeholder="진행 상황, 이슈, 담당자, 참고 링크 등을 자세히 적어주세요.">${esc(t.notes)}</textarea>
          <div class="help">줄 앞에 <code>- </code> 를 쓰면 글머리표, <code>- [ ]</code> / <code>- [x]</code> 는 세부 체크 항목으로 보입니다. 링크는 자동으로 연결돼요.</div>
        </div>
        <div class="modal-foot">
          ${task ? `<button type="button" class="btn danger" data-action="delete-task" data-id="${task.id}">삭제</button><span class="grow"></span>` : ''}
          <button type="button" class="btn" data-action="close-modal">취소</button>
          <button class="btn primary">${task ? '저장' : '추가'}</button>
        </div>
      </form>`);
    const form = $('form', m);
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const data = { title: f.get('title').trim(), priority: f.get('priority'), due: f.get('due') || '', notes: f.get('notes').replace(/\s+$/, '') };
      if (!data.title) return;
      if (task) {
        if (data.notes !== task.notes) data.notesAt = Date.now();
        Object.assign(task, data);
      } else {
        const date = ctx.askDate ? (isDate(f.get('date')) ? weekStart(f.get('date')) : '') : ctx.date;
        if (!isDate(date)) return;
        let tabId = ctx.tabId, projectId = ctx.projectId;
        if (ctx.chooseTab) {
          const picked = findTab(f.get('tabId'))?.tab;
          if (!picked) return;
          tabId = picked.id; projectId = picked.projectId;
        }
        if (!tabId) tabId = tabFor(date, projectId).id;
        const nt = { id: uid(), date, tabId, projectId, done: false, createdAt: Date.now(), ...data };
        if (data.notes) nt.notesAt = Date.now();
        state.tasks.unshift(nt); // 새 Task는 맨 위에
        tmp.flash = nt.id;
        if (ctx.askDate && state.view.type === 'day') state.view = { type: 'day', date };
      }
      closeModal(); commit();
    };
  }

  function projectModal(p) {
    const cur = p || { name: '', color: COLORS[state.projects.length % COLORS.length] };
    const m = openModal(`<h3>${p ? '프로젝트 편집' : '새 프로젝트'}</h3>
      <form>
        <div class="field"><label>이름</label><input class="input" name="name" value="${esc(cur.name)}" placeholder="예) TTA 인터페이스" autofocus autocomplete="off" required></div>
        <div class="field"><label>색상</label><div class="swatches">
          ${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${cur.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}
        </div></div>
        <div class="modal-foot"><button type="button" class="btn" data-action="close-modal">취소</button><button class="btn primary">${p ? '저장' : '만들기'}</button></div>
      </form>`, 'sm');
    const form = $('form', m);
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const name = f.get('name').trim(); if (!name) return;
      if (p) Object.assign(p, { name, color: f.get('color') || p.color });
      else {
        const np = newProject(name); np.color = f.get('color') || np.color;
        state.view = { type: 'project', projectId: np.id }; tmp.filter = 'all';
      }
      closeModal(); commit();
    };
  }

  // 이전 주의 미완료 Task를 이 주로 가져오기 (원본에는 "이월됨" 표시)
  function carryModal(date) {
    const cands = carryCandidates(date);
    if (!cands.length) return toast('가져올 미완료 Task가 없어요');
    const pids = [...new Set(cands.map((t) => t.projectId))];
    const m = openModal(`<h3>미완료 Task 가져오기</h3>
      <div class="help" style="margin:-8px 0 14px">선택한 Task를 <b>${weekLabel(date)}</b>로 가져와요. 이전 주에는 "이월됨" 표시가 남아요.</div>
      <form>
        <div class="carry-list">
          ${pids.map((pid) => `<div class="carry-proj"><span class="dot" style="background:${projColor(pid)}"></span>${esc(projName(pid))}</div>
            ${cands.filter((t) => t.projectId === pid).map((t) => `<label class="carry-item"><input type="checkbox" name="ids" value="${t.id}" checked>
              ${priTag(t)}<span class="ct">${esc(t.title)}</span><span class="cf">${weekName(t.date)}</span></label>`).join('')}`).join('')}
        </div>
        <div class="modal-foot">
          <button type="button" class="btn sm" data-toggle-all>전체 선택/해제</button><span class="grow"></span>
          <button type="button" class="btn" data-action="close-modal">취소</button>
          <button class="btn primary">가져오기</button>
        </div>
      </form>`);
    const form = $('form', m);
    $('[data-toggle-all]', m).onclick = () => {
      const boxes = [...form.querySelectorAll('input[name=ids]')];
      const on = !boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = on));
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const ids = [...form.querySelectorAll('input[name=ids]:checked')].map((b) => b.value);
      if (!ids.length) return;
      const copies = ids.map(findTask).filter(Boolean).map((o) => {
        const tab = tabFor(date, o.projectId);
        o.carriedTo = date;
        return {
          id: uid(), date, tabId: tab.id, projectId: o.projectId, title: o.title, priority: o.priority, due: o.due,
          notes: o.notes, notesAt: o.notesAt, done: false, createdAt: Date.now(), carriedFrom: o.date, carriedFromId: o.id,
        };
      });
      state.tasks.unshift(...copies);
      closeModal(); commit();
      toast(`미완료 Task ${copies.length}개를 가져왔어요`);
    };
  }

  function newDay() {
    askDate('주 추가 — 그 주의 아무 날짜나 고르세요', today(), '만들기').then((picked) => {
      const date = weekStart(picked);
      const existed = !!getDay(date);
      ensureDay(date);
      openDay(date);
      if (existed) toast('이미 있는 주라서 열었어요');
    });
  }
  function openDay(date, projectId) {
    if (projectId) {
      const tab = getDay(date)?.tabs.find((t) => t.projectId === projectId);
      if (tab) tmp.activeTab[date] = tab.id;
    }
    state.ui.months[weekMonthKey(date)] = false;
    state.view = { type: 'day', date };
    tmp.filter = 'all'; tmp.editingNotes = null;
    commit(); closeSidebar();
  }
  function gotoTask(t) {
    tmp.activeTab[t.date] = t.tabId;
    state.ui.months[weekMonthKey(t.date)] = false;
    state.view = { type: 'day', date: t.date };
    tmp.filter = 'all'; tmp.flash = t.id;
    commit(); closeSidebar();
  }

  function searchModal() {
    const m = openModal(`<input class="input" placeholder="Task 제목 · 비고 · 프로젝트 · 날짜(2026-09-10)로 주 검색" autofocus autocomplete="off"><div class="results"></div>`, 'search-modal');
    const inp = $('input', m), box = $('.results', m);
    let sel = 0, hits = [];
    const hl = (s, q) => { const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length)); };
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      hits = [];
      if (q) {
        state.days.forEach((d) => {
          if (weekLabel(d.date).includes(q) || d.date.includes(q) || (isDate(q) && weekStart(q) === d.date)) hits.push({ kind: 'day', d });
        });
        state.projects.forEach((p) => { if (p.name.toLowerCase().includes(q)) hits.push({ kind: 'project', p }); });
        state.tasks.forEach((t) => { if (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)) hits.push({ kind: 'task', t }); });
      }
      sel = Math.min(sel, Math.max(0, hits.length - 1));
      box.innerHTML = !q ? '<div class="empty" style="padding:24px">검색어를 입력하세요</div>'
        : !hits.length ? '<div class="empty" style="padding:24px">결과가 없습니다</div>'
        : hits.slice(0, 50).map((h, i) => {
          const c = `result ${i === sel ? 'sel' : ''}`;
          if (h.kind === 'day') return `<div class="${c}" data-i="${i}"><div class="rt">🗓 ${hl(weekLabel(h.d.date), q)}</div><div class="rs">업무일지 · 탭 ${h.d.tabs.length}개</div></div>`;
          if (h.kind === 'project') return `<div class="${c}" data-i="${i}"><div class="rt">📁 ${hl(h.p.name, q)}</div><div class="rs">프로젝트 · Task ${projTasks(h.p.id).length}개</div></div>`;
          const t = h.t, ni = t.notes.toLowerCase().indexOf(q);
          const snippet = ni >= 0 ? hl(t.notes.slice(Math.max(0, ni - 20), ni + 60).replace(/\n/g, ' '), q) : '';
          return `<div class="${c}" data-i="${i}">
            <div class="rt">${priTag(t)}${t.done ? '<s>' : ''}${hl(t.title, q)}${t.done ? '</s>' : ''}</div>
            <div class="rs">${esc(projName(t.projectId))} · ${weekLabel(t.date)}${snippet ? ' · 비고: ' + snippet : ''}</div></div>`;
        }).join('');
    };
    const go = (h) => {
      if (!h) return;
      closeModal();
      if (h.kind === 'day') openDay(h.d.date);
      else if (h.kind === 'project') { state.view = { type: 'project', projectId: h.p.id }; tmp.filter = 'all'; commit(); closeSidebar(); }
      else gotoTask(h.t);
    };
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, hits.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter') go(hits[sel]);
    };
    box.onclick = (e) => { const r = e.target.closest('.result'); if (r) go(hits[+r.dataset.i]); };
    draw();
  }

  function showMenu(anchor, items) {
    closeMenu();
    const r = anchor.getBoundingClientRect();
    const root = $('#menu-root');
    root.innerHTML = `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' : `<button data-mi="${i}" class="${it.danger ? 'danger' : ''}">${it.label}</button>`).join('')}</div>`;
    const menu = $('.menu', root);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + h + 4 > innerHeight ? r.top - h - 4 : r.bottom + 4) + 'px';
    menu.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (b) { closeMenu(); items[+b.dataset.mi].fn(); } };
  }
  const closeMenu = () => { $('#menu-root').innerHTML = ''; };

  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  const openSidebar = () => $('.app').classList.add('side-open');
  const closeSidebar = () => $('.app').classList.remove('side-open');

  // ───────── 내보내기 / 공유 ─────────
  const statusOf = (t) => (t.done ? '완료' : t.carriedTo ? `이월(→${weekName(t.carriedTo)})` : '미완료');
  const tabLabelOf = (t) => findTab(t.tabId)?.tab.label || '';
  function rowOf(t, cols) {
    const all = {
      '주': `${weekLabel(t.date)}`, '프로젝트': projName(t.projectId), '탭 메모': tabLabelOf(t), '상태': statusOf(t), 'Task': t.title,
      '우선순위': PRI[t.priority].label, '마감일': t.due || '', '비고': t.notes || '',
      '이월': t.carriedFrom ? `${weekName(t.carriedFrom)}에서` : '', '완료일시': t.done && t.doneAt ? stamp(t.doneAt) : '',
    };
    return Object.fromEntries(cols.map((c) => [c, all[c]]));
  }
  const WIDTH = { '주': 24, '프로젝트': 18, '탭 메모': 12, '상태': 16, 'Task': 40, '우선순위': 9, '마감일': 12, '비고': 70, '이월': 14, '완료일시': 14 };
  function download(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportExcel(tasks, cols, filename, sheet) {
    const rows = tasks.map((t) => rowOf(t, cols));
    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
      ws['!cols'] = cols.map((c) => ({ wch: WIDTH[c] || 12 }));
      XLSX.utils.book_append_sheet(wb, ws, (sheet || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31));
      XLSX.writeFile(wb, filename + '.xlsx');
    } else {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))];
      download(filename + '.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    }
    toast('엑셀 파일을 내려받았습니다');
  }
  const byOrder = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.done - b.done) || PRI_ORDER.indexOf(a.priority) - PRI_ORDER.indexOf(b.priority));
  function exportDay(date) {
    const day = getDay(date);
    const order = new Map((day?.tabs || []).map((t, i) => [t.id, i]));
    const tasks = dayTasks(date).sort((a, b) => (order.get(a.tabId) - order.get(b.tabId)) || byOrder(a, b));
    exportExcel(tasks, ['프로젝트', '탭 메모', '상태', 'Task', '우선순위', '마감일', '비고', '이월', '완료일시'], `업무일지_${weekName(date)}_${date}`, weekName(date));
  }
  const exportProject = (p) => exportExcel(projTasks(p.id).sort(byOrder), ['주', '상태', 'Task', '우선순위', '마감일', '비고', '이월', '완료일시'], `${p.name}_${today()}`, p.name);
  const exportAll = () => exportExcel([...state.tasks].sort(byOrder), ['주', '프로젝트', '탭 메모', '상태', 'Task', '우선순위', '마감일', '비고', '이월', '완료일시'], `근무일지_전체_${today()}`, '전체');

  function taskLines(tasks, indent = '') {
    const out = [];
    [...tasks].sort((a, b) => ((a.done ? 2 : a.carriedTo ? 1 : 0) - (b.done ? 2 : b.carriedTo ? 1 : 0)) || PRI_ORDER.indexOf(a.priority) - PRI_ORDER.indexOf(b.priority))
      .forEach((t) => {
        const extra = [t.due ? `마감 ${short(t.due)}` : '', t.carriedTo ? `→ ${weekName(t.carriedTo)} 이월` : ''].filter(Boolean).join(', ');
        out.push(`${indent}${t.done ? '☑' : '☐'} [${PRI[t.priority].label}] ${t.title}${extra ? ` (${extra})` : ''}`);
        if (t.notes.trim()) t.notes.trim().split('\n').forEach((n) => out.push(`${indent}    ${n}`));
      });
    return out;
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    toast(msg);
  }
  function shareDay(date) {
    const s = stats(dayTasks(date));
    const lines = [`[${weekLabel(date)} 업무일지] ${s.done}/${s.total} 완료 (${s.pct}%)`];
    (getDay(date)?.tabs || []).forEach((tab) => {
      lines.push('', `■ ${projName(tab.projectId)}${tab.label ? ` · ${tab.label}` : ''}`, ...taskLines(tabTasks(tab.id)));
    });
    copyText(lines.join('\n'), '주간 업무일지가 클립보드에 복사되었습니다. 메신저에 붙여넣기 하세요');
  }
  function shareProject(p) {
    const all = projTasks(p.id), s = stats(all);
    const lines = [`[${p.name}] ${s.done}/${s.total} 완료 (${s.pct}%)`];
    [...new Set(all.map((t) => t.date))].sort().reverse().forEach((d) => {
      lines.push('', `■ ${weekLabel(d)}`, ...taskLines(all.filter((t) => t.date === d)));
    });
    copyText(lines.join('\n'), '프로젝트 진행 현황이 클립보드에 복사되었습니다');
  }

  function importJSON() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const d = normalize(JSON.parse(await f.text()));
        delete d.__migrated;
        if (!(await confirmDlg('현재 데이터를 백업 파일의 내용으로 <b>덮어씁니다.</b> 계속할까요?', '가져오기'))) return;
        state = d; commit(); toast('백업을 불러왔습니다');
      } catch { toast('올바른 백업 파일이 아닙니다'); }
    };
    inp.click();
  }

  // 지금 화면 기준으로 Task 추가
  function addTaskHere() {
    const v = state.view;
    if (v.type === 'day') {
      const tab = activeTabOf(v.date);
      if (!tab) return actions['add-tab']({ dataset: { date: v.date } });
      if (tab === ALL) return taskModal(null, { date: v.date, chooseTab: true });
      taskModal(null, { date: v.date, tabId: tab.id, projectId: tab.projectId });
    } else if (v.type === 'project') {
      taskModal(null, { projectId: v.projectId, askDate: true });
    }
  }

  // ───────── 이벤트 ─────────
  const actions = {
    go: (el) => { state.view = { type: el.dataset.view }; commit(); closeSidebar(); },
    'open-day': (el) => openDay(el.dataset.date, el.dataset.project),
    'open-project': (el) => {
      if (state.view.projectId !== el.dataset.id) tmp.filter = 'all';
      state.view = { type: 'project', projectId: el.dataset.id }; tmp.editingNotes = null; commit(); closeSidebar();
    },
    'start-today': () => { ensureDay(thisWeek()); openDay(thisWeek()); },
    'toggle-month': (el) => {
      const mk = el.dataset.m, td = weekMonthKey(thisWeek()), openM = state.view.type === 'day' ? weekMonthKey(state.view.date) : td;
      const cur = state.ui.months[mk] ?? (mk !== openM && mk !== td);
      state.ui.months[mk] = !cur; commit();
    },
    'new-day': () => newDay(),
    'new-project': () => projectModal(),
    'select-tab': (el) => { tmp.activeTab[el.dataset.date] = el.dataset.id; tmp.editingNotes = null; render(); },
    'add-tab': async (el) => {
      const date = el.dataset.date;
      const r = await pickProjectModal({ title: `탭 추가 · ${weekLabel(date)}`, withLabel: true, ok: '추가' });
      const tab = addTab(date, r.projectId, r.label);
      tmp.activeTab[date] = tab.id;
      state.ui.months[weekMonthKey(date)] = false;
      commit();
    },
    'tab-menu': (el) => {
      const date = el.dataset.date, day = getDay(date), tab = day?.tabs.find((t) => t.id === el.dataset.id);
      if (!tab) return;
      showMenu(el, [
        { label: '🔁 프로젝트 변경', fn: async () => {
          const r = await pickProjectModal({ title: '탭의 프로젝트 변경', current: tab.projectId, ok: '변경' });
          tab.projectId = r.projectId;
          tabTasks(tab.id).forEach((t) => (t.projectId = r.projectId));
          commit();
        } },
        { label: '✏️ 탭 메모', fn: async () => { const v = await askText('탭 메모', tab.label || '', '예) 오전, 2차 테스트'); if (v !== undefined) { tab.label = v; commit(); } } },
        { label: '📁 프로젝트 화면으로', fn: () => { state.view = { type: 'project', projectId: tab.projectId }; tmp.filter = 'all'; commit(); } },
        '-',
        { label: '🗑 탭 삭제', danger: true, fn: async () => {
          const n = tabTasks(tab.id).length;
          if (!(await confirmDlg(`<b>${esc(projName(tab.projectId))}</b> 탭을 삭제할까요?${n ? `<br>이 탭의 Task ${n}개도 함께 삭제돼요.` : ''}`))) return;
          removeTasks(tabTasks(tab.id).map((t) => t.id));
          day.tabs = day.tabs.filter((t) => t !== tab);
          commit(); toast('삭제되었습니다');
        } },
      ]);
    },
    'day-menu': (el) => {
      const date = el.dataset.date, day = getDay(date);
      if (!day) return;
      showMenu(el, [
        { label: '📅 주 변경', fn: async () => {
          const nd = weekStart(await askDate('주 변경 — 옮길 주의 아무 날짜나 고르세요', date, '변경'));
          if (nd === date) return;
          const target = getDay(nd);
          dayTasks(date).forEach((t) => (t.date = nd));
          state.tasks.forEach((t) => { if (t.carriedTo === date) t.carriedTo = nd; if (t.carriedFrom === date) t.carriedFrom = nd; });
          if (target) { target.tabs.push(...day.tabs); state.days = state.days.filter((d) => d !== day); }
          else { day.date = nd; state.days.sort((a, b) => (a.date < b.date ? 1 : -1)); }
          openDay(nd);
          toast(target ? '이미 있던 주에 합쳤어요' : '주를 바꿨어요');
        } },
        { label: '📊 이 주 엑셀 다운로드', fn: () => exportDay(date) },
        { label: '📋 이 주 공유 (텍스트 복사)', fn: () => shareDay(date) },
        '-',
        { label: '🗑 이 주 삭제', danger: true, fn: async () => {
          const n = dayTasks(date).length;
          if (!(await confirmDlg(`<b>${weekLabel(date)}</b> 업무일지를 삭제할까요?${n ? `<br>이 주의 Task ${n}개도 함께 삭제돼요.` : ''}`))) return;
          removeTasks(dayTasks(date).map((t) => t.id));
          state.days = state.days.filter((d) => d !== day);
          if (state.view.type === 'day' && state.view.date === date) state.view = { type: 'home' };
          commit(); toast('삭제되었습니다');
        } },
      ]);
    },
    'project-menu': (el) => {
      const p = getProject(el.dataset.id);
      if (!p) return;
      showMenu(el, [
        { label: '✏️ 편집 (이름·색상)', fn: () => projectModal(p) },
        { label: '📊 전체 이력 엑셀 다운로드', fn: () => exportProject(p) },
        { label: '📋 공유 (텍스트 복사)', fn: () => shareProject(p) },
        '-',
        { label: '🗑 프로젝트 삭제', danger: true, fn: async () => {
          const n = projTasks(p.id).length;
          if (!(await confirmDlg(`<b>${esc(p.name)}</b> 프로젝트를 삭제할까요?<br>모든 주의 이 프로젝트 탭과 Task ${n}개가 함께 삭제돼요.`))) return;
          removeTasks(projTasks(p.id).map((t) => t.id));
          state.days.forEach((d) => { d.tabs = d.tabs.filter((t) => t.projectId !== p.id); });
          state.projects = state.projects.filter((x) => x !== p);
          if (state.view.projectId === p.id) state.view = { type: 'home' };
          commit(); toast('삭제되었습니다');
        } },
      ]);
    },
    'rename-project': async (el) => { const p = getProject(el.dataset.id); const n = await askText('프로젝트 이름 변경', p.name); if (n) { p.name = n; commit(); } },
    'user-menu': (el) => showMenu(el, [
      { label: '👤 표시 이름 변경', fn: async () => { const n = await askText('표시 이름 변경', userName()); if (n) { state.user = n; commit(); } } },
      { label: '📊 전체 엑셀 다운로드', fn: exportAll },
      '-',
      { label: '💾 백업 내보내기 (JSON)', fn: () => download(`근무일지_백업_${today()}.json`, new Blob([JSON.stringify(contentOf(state), null, 2)], { type: 'application/json' })) },
      { label: '📂 백업 가져오기', fn: importJSON },
      '-',
      ...(!Sync.enabled() ? [{ label: '☁ 구글 드라이브 설정 방법', fn: Sync.showSetup }]
        : [{ label: '🔄 지금 동기화', fn: Sync.syncNow }, { label: '🚪 로그아웃', danger: true, fn: Sync.logout }]),
    ]),
    'sync-click': () => Sync.onStatusClick(),
    login: () => Sync.login(),
    guest: () => Sync.guest(),
    'show-setup': () => Sync.showSetup(),
    'toggle-summary': () => { state.ui.summaryHidden = !state.ui.summaryHidden; commit(); },
    filter: (el) => { tmp.filter = el.dataset.f; render(); },
    sort: () => { state.ui.sortPriority = !state.ui.sortPriority; commit(); },
    excel: () => { const v = state.view; if (v.type === 'day') exportDay(v.date); else if (v.type === 'project') exportProject(getProject(v.projectId)); },
    share: () => { const v = state.view; if (v.type === 'day') shareDay(v.date); else if (v.type === 'project') shareProject(getProject(v.projectId)); },
    carry: (el) => carryModal(el.dataset.date),
    'add-task': () => addTaskHere(),
    'toggle-task': (el) => {
      const t = findTask(el.dataset.id); if (!t) return;
      t.done = !t.done;
      if (t.done) t.doneAt = Date.now(); else delete t.doneAt;
      commit();
    },
    'edit-task': (el) => { const t = findTask(el.dataset.id); if (t) taskModal(t); },
    'delete-task': async (el) => {
      const t = findTask(el.dataset.id); if (!t) return;
      if (!(await confirmDlg(`<b>${esc(t.title)}</b> Task를 삭제할까요?`))) return;
      removeTasks([t.id]); commit(); toast('삭제되었습니다');
    },
    'edit-notes': (el) => { tmp.editingNotes = el.dataset.id; render(); },
    'close-notes': () => finishNotes(),
    'toggle-expand': (el) => {
      const id = el.dataset.id;
      tmp.expandedNotes.has(id) ? tmp.expandedNotes.delete(id) : tmp.expandedNotes.add(id); render();
    },
    'goto-task': (el) => { const t = findTask(el.dataset.id); if (t) gotoTask(t); },
    'cal-move': (el) => {
      const d = +el.dataset.d;
      if (!d) state.ui.calMonth = today().slice(0, 7);
      else { const [y, m] = state.ui.calMonth.split('-').map(Number); const n = new Date(y, m - 1 + d, 1); state.ui.calMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; }
      commit();
    },
    search: () => { closeSidebar(); searchModal(); },
    shortcuts: () => openModal(`<h3>단축키</h3>
      <div style="line-height:2.2"><kbd style="background:#eee;color:#444">Ctrl K</kbd> 검색<br>
      <kbd style="background:#eee;color:#444">N</kbd> Task 추가 (주간별 · 프로젝트별 화면)<br>
      <kbd style="background:#eee;color:#444">Ctrl Enter</kbd> / <kbd style="background:#eee;color:#444">Esc</kbd> 비고 편집 닫기<br>
      <kbd style="background:#eee;color:#444">Esc</kbd> 창 닫기</div>
      <div class="modal-foot"><button class="btn primary" data-action="close-modal">닫기</button></div>`, 'sm'),
    'close-modal': () => closeModal(),
    'modal-back': (el, e) => { if (e.target === el) closeModal(); },
    'open-sidebar': openSidebar,
    'close-sidebar': closeSidebar,
  };

  function finishNotes() {
    const id = tmp.editingNotes; if (!id) return;
    tmp.editingNotes = null;
    const t = findTask(id);
    if (t) t.notes = t.notes.replace(/\s+$/, '');
    commit();
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('[data-action$="-menu"]')) closeMenu();
    if (e.target.closest('.notes-text a')) return; // 비고 속 링크는 그대로 열기
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (tmp.editingNotes && !el.closest('.notes-edit') && el.dataset.action !== 'edit-notes') {
      tmp.editingNotes = null; // 비고 편집 중 다른 곳 클릭 → 먼저 편집 닫기
    }
    const fn = actions[el.dataset.action];
    // 모달 배경은 배경 자체를 클릭했을 때만 처리 — 창 안의 입력칸·라디오·제출 버튼 기본 동작을 막지 않도록
    if (el.dataset.action === 'modal-back' && e.target !== el) return;
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  // 비고 인라인 편집 — 입력 즉시 자동 저장
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(90, ta.scrollHeight + 2) + 'px'; }
  document.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-notes]'); if (!ta) return;
    const t = findTask(ta.dataset.notes); if (!t) return;
    t.notes = ta.value; t.notesAt = Date.now();
    autoGrow(ta); save();
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches('textarea[data-notes]')) return;
    setTimeout(() => { if (tmp.editingNotes === e.target.dataset.notes && !document.activeElement?.matches('textarea[data-notes]')) finishNotes(); }, 150);
  });

  document.addEventListener('keydown', (e) => {
    const inField = e.target.matches('input, textarea, select');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!Sync.locked()) searchModal(); return; }
    if (e.target.matches('textarea[data-notes]') && (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)))) {
      e.preventDefault(); e.target.blur(); finishNotes(); return;
    }
    if (e.key === 'Escape') { if ($('#menu-root').innerHTML) closeMenu(); else closeModal(); closeSidebar(); return; }
    if (!inField && !Sync.locked() && !$('#modal-root').innerHTML && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); addTaskHere();
    }
  });

  // ───────── 구글 드라이브 동기화 ─────────
  // 내 드라이브의 '근무일지_데이터.json' 파일 하나를 DB처럼 사용한다.
  // drive.file 권한 → 이 앱이 만든 파일에만 접근 가능 (다른 드라이브 파일은 볼 수 없음)
  function createSync() {
    const CFG = window.WORKLOG_CONFIG || {};
    const META_KEY = 'worklog-sync-v1';
    const TOKEN_KEY = 'worklog-drive-token';
    const FILE_NAME = '근무일지_데이터.json';
    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const SCOPES = `openid email profile ${SCOPE}`;
    const GUEST_KEY = 'worklog-guest';
    const API = 'https://www.googleapis.com/drive/v3';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
    const FIELDS = 'id,version,modifiedTime';

    const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
    const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } };

    // meta: 이 브라우저가 마지막으로 맞춘 드라이브 파일 정보
    const meta = Object.assign({ connected: false, fileId: null, version: null, hash: null, dirty: false, lastSync: null, email: null, profile: null }, readJSON(META_KEY));
    let token = readJSON(TOKEN_KEY);           // { access_token, exp }
    let status = 'off', error = '';
    let tokenClient = null, tokenCb = null;
    let timer = null, busy = false, editSeq = 0, started = false;
    let locked = true, loginBusy = '', loginError = '';
    let needConsent = false; // 드라이브 권한을 빼고 넘어갔으면 다음 로그인 때 권한 화면을 다시 띄움

    const enabled = () => !!CFG.GOOGLE_CLIENT_ID;
    const saveMeta = () => writeJSON(META_KEY, meta);
    const hasToken = () => token && token.exp > Date.now() + 30000;
    const content = contentOf, hash = hashOf;
    const isPristine = () => !!state.sampleHash && hash(content(state)) === state.sampleHash;
    const isGuest = () => localStorage.getItem(GUEST_KEY) === '1';
    const payload = () => ({ app: 'worklog', schema: 1, savedAt: Date.now(), ...content(state) });
    const summary = (d) => {
      const nP = (d.projects || d.lists || []).length;
      const nT = Array.isArray(d.tasks) ? d.tasks.length : (d.lists || []).reduce((a, l) => a + (l.tasks || []).length, 0);
      return `프로젝트 ${nP}개 · Task ${nT}개${d.savedAt ? ` · ${stamp(d.savedAt)} 저장` : ''}`;
    };
    const authError = (msg) => Object.assign(new Error(msg), { auth: true });

    function setStatus(s, err = '') { status = s; error = err; renderStatus(); }

    // ── 로그인 (Google Identity Services 토큰 방식) ──
    function gisReady() {
      return new Promise((resolve, reject) => {
        let n = 0;
        const t = setInterval(() => {
          if (window.google?.accounts?.oauth2) { clearInterval(t); resolve(); }
          else if (++n > 100) { clearInterval(t); reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다 (인터넷 연결 확인)')); }
        }, 100);
      });
    }
    async function requestToken() {
      await gisReady();
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CFG.GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (r) => tokenCb && tokenCb(r),
          error_callback: (e) => tokenCb && tokenCb({ error: e.type || 'popup_failed' }),
        });
      }
      return new Promise((resolve, reject) => {
        tokenCb = (r) => {
          if (r.error) {
            const msg = r.error === 'popup_closed' ? '로그인 창이 닫혔습니다'
              : r.error === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요'
              : r.error === 'access_denied' ? '드라이브 접근 권한이 거부되었습니다' : `로그인 실패 (${r.error})`;
            return reject(authError(msg));
          }
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
            needConsent = true;
            return reject(authError('드라이브 권한이 허용되지 않았어요. 다시 로그인한 뒤 권한 화면에서 "Google Drive" 항목에 꼭 체크해 주세요.'));
          }
          needConsent = false;
          token = { access_token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          writeJSON(TOKEN_KEY, token);
          resolve();
        };
        tokenClient.requestAccessToken({ prompt: needConsent ? 'consent' : '', ...(meta.email ? { login_hint: meta.email } : {}) });
      });
    }

    // ── Drive REST API ──
    async function gfetch(url, opts = {}) {
      if (!hasToken()) throw authError('로그인이 만료되었습니다');
      const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.access_token}` } });
      if (r.status === 401) { token = null; localStorage.removeItem(TOKEN_KEY); throw authError('로그인이 만료되었습니다'); }
      if (r.status === 404) throw Object.assign(new Error('드라이브 파일을 찾을 수 없습니다'), { notFound: true });
      if (!r.ok) {
        let m = ''; try { m = (await r.json()).error.message; } catch { /* 무시 */ }
        throw new Error(`드라이브 오류 (${r.status}) ${m}`);
      }
      return r;
    }
    async function findFile() {
      const q = encodeURIComponent("appProperties has { key='worklog' and value='1' } and trashed=false");
      const r = await gfetch(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(${FIELDS})`);
      return (await r.json()).files[0] || null;
    }
    const getMeta = async (id) => (await gfetch(`${API}/files/${id}?fields=${FIELDS}`)).json();
    const getContent = async (id) => (await gfetch(`${API}/files/${id}?alt=media`)).json();
    async function createFile(data) {
      const b = 'worklog' + uid();
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
        + JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', appProperties: { worklog: '1' } })
        + `\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${b}--`;
      return (await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`,
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body })).json();
    }
    const updateFile = async (id, data) => (await gfetch(`${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(data) })).json();

    function synced(m, data) {
      meta.fileId = m.id; meta.version = m.version; meta.hash = hash(content(data));
      meta.dirty = false; meta.lastSync = Date.now(); saveMeta();
    }
    function applyRemote(data, m) {
      state = normalize({ ...JSON.parse(JSON.stringify(data)), view: state.view, ui: state.ui });
      if (state.view.type === 'project' && !getProject(state.view.projectId)) state.view = { type: 'home' };
      const migrated = state.__migrated; delete state.__migrated;
      synced(m, data);
      saveLocal();
      render();
      if (migrated) markDirty();
    }

    function handleErr(e) {
      console.error('[드라이브 동기화]', e);
      if (e.auth) setStatus('auth', e.message);
      else setStatus('error', e.message || String(e));
    }

    // 드라이브 쪽과 이 PC 쪽이 서로 다르게 바뀌었을 때
    function conflictDialog(remote, isFirstLink) {
      return new Promise((resolve) => {
        const title = isFirstLink ? '드라이브에 저장된 근무일지가 있어요' : '다른 PC에서 수정된 내용이 있어요';
        const desc = isFirstLink
          ? '어느 쪽 데이터를 사용할까요? 선택하지 않은 쪽 데이터는 사라집니다.<br><span class="help">걱정되면 먼저 ⋯ 메뉴의 <b>백업 내보내기</b>로 이 PC 데이터를 저장해 두세요.</span>'
          : '이 PC에서 저장하지 못한 변경 사항과 드라이브의 최신 내용이 서로 다릅니다.<br>어느 쪽을 남길까요?';
        const m = openModal(`<h3>${title}</h3><div style="line-height:1.6">${desc}</div>
          <div class="choice-grid">
            <button class="choice" data-c="remote"><b>☁ 드라이브 내용 사용</b><span>${esc(summary(remote))}</span></button>
            <button class="choice" data-c="local"><b>💻 이 PC 내용 사용</b><span>${esc(summary(state))}</span></button>
          </div>
          <div class="modal-foot"><button class="btn" data-c="later">나중에</button></div>`, 'sm');
        m.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { closeModal(); resolve(b.dataset.c); }));
      });
    }

    // 연결 직후 / 페이지를 열 때: 드라이브와 이 PC를 맞춤
    async function reconcile() {
      setStatus('loading');
      let file = null;
      if (meta.fileId) file = await getMeta(meta.fileId).catch((e) => { if (e.notFound) return null; throw e; });
      if (!file) file = await findFile();

      if (!file) {                                   // 드라이브에 아직 파일 없음 → 새로 만들기
        const data = payload();
        synced(await createFile(data), data);
        setStatus('idle');
        toast('구글 드라이브에 근무일지 파일을 만들었어요');
        return;
      }
      const sameFile = meta.fileId === file.id;
      if (sameFile && file.version === meta.version) { // 드라이브 변화 없음
        if (meta.dirty) await push(); else setStatus('idle');
        return;
      }
      const remote = await getContent(file.id);
      const remoteHash = hash(content(remote));
      if (remoteHash === hash(content(state)) || (sameFile && remoteHash === meta.hash)) {
        // 내용이 같거나, 드라이브는 내가 마지막으로 올린 그대로 → 버전 정보만 갱신
        synced(file, remote);
        if (remoteHash !== hash(content(state))) { meta.dirty = true; saveMeta(); await push(); } else setStatus('idle');
        return;
      }
      if ((sameFile && !meta.dirty) || (!sameFile && isPristine())) { // 다른 PC에서만 바뀜 / 새 PC → 받아오기
        applyRemote(remote, file);
        setStatus('idle');
        if (started) toast('다른 PC에서 수정된 내용을 불러왔어요');
        return;
      }
      setStatus('conflict');                         // 양쪽 다 바뀜 → 사용자 선택
      const c = await conflictDialog(remote, !sameFile);
      if (c === 'later') return;
      if (c === 'remote') { applyRemote(remote, file); setStatus('idle'); toast('드라이브 내용을 불러왔어요'); }
      else { synced(file, remote); meta.dirty = true; saveMeta(); await push(true); toast('이 PC 내용으로 드라이브를 업데이트했어요'); }
    }

    // 변경 사항 올리기
    async function push(force = false) {
      if (!meta.connected || !meta.fileId) return;
      if (busy) { timer = setTimeout(() => push(force), 800); return; }
      busy = true;
      const seq = editSeq;
      try {
        if (!force) {
          const m = await getMeta(meta.fileId);
          if (m.version !== meta.version) { busy = false; return await reconcile(); }
        }
        setStatus('saving');
        const data = payload();
        const m = await updateFile(meta.fileId, data);
        synced(m, data);
        if (seq !== editSeq) { meta.dirty = true; saveMeta(); schedule(300); } // 업로드 중에 또 수정됨
        setStatus('idle');
      } catch (e) {
        if (e.notFound) { meta.fileId = null; saveMeta(); busy = false; return run(reconcile); }
        handleErr(e);
      } finally { busy = false; }
    }
    function schedule(ms = 1200) {
      clearTimeout(timer);
      if (!meta.connected) return;
      if (!hasToken()) { setStatus('auth', '로그인이 만료되었습니다'); return; }
      if (status === 'conflict') return renderStatus();
      renderStatus();
      timer = setTimeout(() => run(push), ms);
    }
    async function run(fn) { try { await fn(); } catch (e) { handleErr(e); } }

    // ── 로그인 / 로그아웃 ──
    function resetLocal() {
      state = sampleData(); saveLocal();
      Object.assign(meta, { fileId: null, version: null, hash: null, dirty: false, lastSync: null });
    }
    async function login() {
      if (!enabled()) return showSetup();
      if (location.protocol === 'file:') {
        loginError = '파일을 직접 열면 구글 로그인이 안 돼요. 브라우저 주소창에 http://localhost:5173 을 입력해서 열어주세요.';
        return renderGate();
      }
      if (loginBusy) return;
      loginError = ''; loginBusy = '구글 로그인 창에서 계정을 선택해 주세요…'; renderGate();
      try {
        await requestToken();
        loginBusy = '근무일지를 불러오는 중…'; renderGate();
        const p = await (await gfetch('https://www.googleapis.com/oauth2/v3/userinfo')).json();
        if (meta.email && meta.email !== p.email) resetLocal(); // 다른 계정 → 이전 사람 데이터 지우기
        Object.assign(meta, { connected: true, email: p.email, profile: { name: p.name || p.email, email: p.email, picture: p.picture || '' } });
        saveMeta();
        try { await reconcile(); } catch (e) { handleErr(e); }
        started = true;
        loginBusy = ''; locked = false; render();
      } catch (e) {
        console.error('[로그인]', e);
        loginBusy = ''; loginError = e.message || String(e);
        if (locked) renderGate(); else handleErr(e);
      }
    }
    const renderGate = () => (locked ? renderLogin() : renderStatus());
    async function logout() {
      const warn = meta.dirty ? '<br><b style="color:var(--urgent)">아직 드라이브에 저장되지 않은 변경이 있어요.</b>' : '';
      if (!(await confirmDlg(`로그아웃할까요?<br>이 PC에 남은 근무일지 사본은 지워져요. 드라이브의 데이터는 그대로 남아요.${warn}`, '로그아웃'))) return;
      try { if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {}); } catch { /* 무시 */ }
      token = null; localStorage.removeItem(TOKEN_KEY);
      resetLocal();
      Object.assign(meta, { connected: false, email: null, profile: null });
      saveMeta(); status = 'off'; locked = true; render();
    }
    function guest() { localStorage.setItem(GUEST_KEY, '1'); locked = false; render(); }

    const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';

    function renderLogin() {
      const app = document.querySelector('.app'); if (app) app.hidden = true;
      const root = document.getElementById('login-root');
      const p = meta.profile;
      root.hidden = false;
      root.innerHTML = `<div class="login"><div class="login-card">
        <div class="login-logo">✓</div>
        <h1>근무일지</h1>
        <p class="login-sub">구글 계정으로 로그인하면<br>어느 PC에서든 같은 근무일지를 볼 수 있어요.</p>
        ${p ? `<div class="login-last">${p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(p.name)}</b><span>${esc(p.email)}</span></div></div>` : ''}
        <button class="g-btn" data-action="login" ${loginBusy ? 'disabled' : ''}>${G_LOGO}
          ${loginBusy ? '로그인 중…' : p ? '이 계정으로 계속하기' : 'Google 계정으로 로그인'}</button>
        ${loginBusy ? `<div class="login-busy">${esc(loginBusy)}</div>` : ''}
        ${location.protocol === 'file:' ? `<div class="login-err">⚠ 지금은 파일을 직접 연 상태라 로그인이 안 돼요.<br>브라우저 주소창에 <b>http://localhost:5173</b> 을 입력해서 열어주세요.</div>`
          : loginError ? `<div class="login-err">⚠ ${esc(loginError)}</div>` : ''}
        ${!enabled() ? `<div class="login-warn">아직 구글 연동 설정(클라이언트 ID)이 되어 있지 않아요.<br><button class="link-btn" data-action="show-setup">설정 방법 보기</button> · <button class="link-btn" data-action="guest">로그인 없이 이 PC에서만 사용</button></div>` : ''}
        <div class="login-foot">🔒 데이터는 <b>내 구글 드라이브</b>에 저장돼요.<br>이 사이트는 자기가 만든 근무일지 파일 외에는 드라이브에 접근하지 않아요.</div>
      </div></div>`;
    }
    function hideLogin() {
      const root = document.getElementById('login-root');
      if (root && !root.hidden) { root.hidden = true; root.innerHTML = ''; }
      const app = document.querySelector('.app'); if (app) app.hidden = false;
    }

    async function syncNow() {
      if (!hasToken()) return login();
      await run(reconcile);
    }
    function onStatusClick() {
      if (!enabled()) return showSetup();
      if (!meta.connected || status === 'auth') return login();
      if (status === 'error' || status === 'conflict' || status === 'idle') return syncNow();
    }
    function showSetup() {
      openModal(`<h3>구글 드라이브 연결 설정</h3>
        <div style="line-height:1.7">아직 구글 클라이언트 ID가 설정되지 않았어요.<br>
        프로젝트 폴더의 <code>README.md</code> 안내대로 Google Cloud에서 <b>OAuth 클라이언트 ID</b>를 발급받아
        <code>config.js</code> 파일의 <code>GOOGLE_CLIENT_ID</code>에 붙여넣은 뒤 새로고침하세요.</div>
        <div class="modal-foot"><button class="btn primary" data-action="close-modal">확인</button></div>`, 'sm');
    }
    function markDirty() {
      editSeq++;
      if (!meta.connected) return;
      meta.dirty = true; saveMeta();
      schedule();
    }

    function renderStatus() {
      const el = document.getElementById('sync-status');
      if (!el) return;
      let icon = '☁', text = '', cls = '', btn = '';
      if (!enabled()) { text = '드라이브 미설정'; cls = 'muted'; btn = '설정 방법'; }
      else if (!meta.connected) { text = '이 PC에만 저장 중'; cls = 'muted'; btn = '로그인'; }
      else if (status === 'loading') { icon = '⟳'; text = '드라이브 불러오는 중…'; cls = 'busy'; }
      else if (status === 'saving') { icon = '⟳'; text = '드라이브에 저장 중…'; cls = 'busy'; }
      else if (status === 'auth') { icon = '⚠'; text = meta.dirty ? '로그인 만료 · 저장 안 된 변경 있음' : '로그인 만료'; cls = 'warn'; btn = '다시 로그인'; }
      else if (status === 'error') { icon = '⚠'; text = '동기화 오류'; cls = 'warn'; btn = '다시 시도'; }
      else if (status === 'conflict') { icon = '⚠'; text = '어느 쪽 데이터를 쓸지 선택 필요'; cls = 'warn'; btn = '선택하기'; }
      else if (meta.dirty) { icon = '⟳'; text = '저장 대기 중…'; cls = 'busy'; }
      else { text = `드라이브 저장됨${meta.lastSync ? ' · ' + stamp(meta.lastSync) : ''}`; cls = 'ok'; }
      el.className = `sync ${cls}`;
      el.title = error || '';
      el.innerHTML = `<span class="ic">${icon}</span><span class="tx">${esc(text)}</span>${btn ? `<button class="sync-btn" data-action="sync-click">${btn}</button>` : ''}`;
    }

    function start() {
      // 설정돼 있으면 로그인(유효한 토큰) 필수, 미설정이면 "로그인 없이 사용"을 고른 경우만 통과
      locked = enabled() ? !(meta.connected && hasToken()) : !isGuest();
      render();
      if (!locked && enabled()) run(reconcile).then(() => { started = true; });
    }

    // 다른 PC에서 작업하고 돌아왔을 때 최신 내용 확인
    const pullIfIdle = () => {
      if (meta.connected && hasToken() && !busy && (status === 'idle' || status === 'error')) run(reconcile);
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullIfIdle(); });
    setInterval(() => { if (document.visibilityState === 'visible') pullIfIdle(); }, 2 * 60 * 1000);
    window.addEventListener('beforeunload', (e) => {
      if (meta.connected && (meta.dirty || busy) && hasToken()) { e.preventDefault(); e.returnValue = ''; }
    });

    return { enabled, meta, markDirty, login, logout, guest, syncNow, onStatusClick, showSetup, render: renderStatus, renderLogin, hideLogin, start, locked: () => locked };
  }
  const Sync = createSync();

  window.addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); delete state.__migrated; render(); } });

  init();
  function init() {
    const migrated = state.__migrated; delete state.__migrated;
    saveLocal();
    Sync.start();
    if (migrated) Sync.markDirty(); // 예전 구조에서 바뀐 데이터를 드라이브에도 반영
  }
})();
