// 공통 UI 조각: 아이콘, 토스트, 바텀시트, 고객 카드, 현장 탭, 관리 완료 시트
import { getSettings, db } from './db.js';
import { esc, ddayLabel, bucketOf, gradeClass, fmtShort, addDays, today, CONTACT_KINDS } from './utils.js';
import { addHistory, getCustomer } from './store.js';

export const icon = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;
export const go = (hash) => { location.hash = hash; };

// ---- 토스트 ----
let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

// ---- 바텀시트 ----
export function openSheet(html) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bd, sh);
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    bd.classList.remove('show'); sh.classList.remove('show');
    setTimeout(() => { bd.remove(); sh.remove(); }, 250);
    window.removeEventListener('hashchange', close);
  };
  bd.onclick = close;
  window.addEventListener('hashchange', close);
  return { el: sh, close };
}

export function confirmSheet({ title, message = '', ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    const { el, close } = openSheet(`
      <h2>${esc(title)}</h2><p class="sheet-sub">${esc(message)}</p>
      <div class="btn-row"><button class="btn" data-a="no">취소</button>
      <button class="btn ${danger ? 'btn-primary" style="background:var(--danger);border-color:var(--danger)' : 'btn-primary'}" data-a="ok">${esc(ok)}</button></div>`);
    el.querySelector('[data-a=no]').onclick = () => { close(); resolve(false); };
    el.querySelector('[data-a=ok]').onclick = () => { close(); resolve(true); };
  });
}

// ---- 현장 탭 (홈/고객/캘린더 공통) ----
export const siteState = {
  get() { try { return localStorage.getItem('site') || ''; } catch (e) { return ''; } },
  set(v) { try { localStorage.setItem('site', v); } catch (e) { /* 무시 */ } },
};

export async function siteNames(customers) {
  const s = await getSettings();
  const names = (s.sites || []).map((x) => x.name).filter(Boolean);
  customers.forEach((c) => { if (c.site && !names.includes(c.site)) names.push(c.site); });
  return names;
}

/** 현장 탭 HTML + 선택된 현장으로 필터된 목록 반환 */
export async function siteTabs(customers) {
  const names = await siteNames(customers);
  let cur = siteState.get();
  if (cur && !names.includes(cur)) { cur = ''; siteState.set(''); }
  const filtered = cur ? customers.filter((c) => c.site === cur) : customers;
  if (names.length < 2) return { html: '', filtered, cur };
  const btn = (v, label) => `<button data-site="${esc(v)}" class="${cur === v ? 'on' : ''}">${esc(label)}</button>`;
  const html = `<div class="site-tabs">${btn('', '전체')}${names.map((n) => btn(n, n)).join('')}</div>`;
  return { html, filtered, cur };
}
export function bindSiteTabs(root, rerender) {
  root.querySelectorAll('[data-site]').forEach((b) => {
    b.onclick = () => { siteState.set(b.dataset.site); rerender(); };
  });
}

// ---- 배지·카드 ----
export const ddayBadge = (next, small = false) =>
  `<span class="dday ${bucketOf(next)}${small ? ' small' : ''}">${ddayLabel(next)}</span>`;
export const gradeBadge = (g) => `<span class="badge ${gradeClass(g)}">${esc(g)}</span>`;

export const ownerChip = (name, unassigned) => `<span class="owner${unassigned ? ' none' : ''}">${esc(name)}</span>`;

/** opts.owner: 담당 직원 이름(팀장 화면에서 표시) */
export function customerCard(c, opts = {}) {
  const meta = [c.site, c.unitType].filter(Boolean).map(esc).join(' · ');
  const live = (c.history || []).filter((h) => !h.deleted);
  const lastMemo = (live[0] && live[0].text) || c.memo || '';
  return `
  <div class="ccard-wrap">
    <div class="swipe-bg">${icon('check')} 관리 완료</div>
    <div class="ccard" data-id="${c.id}">
      ${ddayBadge(c.nextDate)}
      <div class="body">
        <div class="name">${esc(c.name)} ${gradeBadge(c.grade)}${opts.owner ? ownerChip(opts.owner, !c.owner) : ''}</div>
        <div class="meta">${meta || esc(c.phone)}</div>
        ${lastMemo ? `<div class="memo">${esc(lastMemo)}</div>` : ''}
      </div>
      <a class="call-btn" href="tel:${esc(c.phoneDigits || '')}" aria-label="${esc(c.name)}에게 전화" data-stop>${icon('phone', 'sm')}</a>
      <button class="done-btn" aria-label="관리 완료" data-done>${icon('check')}</button>
    </div>
  </div>`;
}

/** 카드 클릭 → 상세, ✓ → 관리 완료, 오른쪽 스와이프 → 관리 완료 */
export function bindCards(root, onChange) {
  root.querySelectorAll('.ccard').forEach((card) => {
    const id = card.dataset.id;
    let sx = 0, sy = 0, dx = 0, dragging = false, moved = false, pid = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-done],[data-stop]')) return;
      sx = e.clientX; sy = e.clientY; dx = 0; dragging = false; moved = false; pid = e.pointerId;
    });
    card.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const mx = e.clientX - sx, my = e.clientY - sy;
      if (!dragging && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) {
        dragging = true; moved = true; card.classList.add('dragging'); card.parentElement.classList.add('swiping');
        try { card.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      }
      if (dragging) { dx = Math.max(0, Math.min(mx, 160)); card.style.transform = `translateX(${dx}px)`; }
    });
    const end = () => {
      if (pid === null) return;
      pid = null; card.classList.remove('dragging'); card.style.transform = '';
      setTimeout(() => card.parentElement && card.parentElement.classList.remove('swiping'), 200);
      if (dragging && dx > 90) doneSheet(id, onChange);
      dragging = false;
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    card.addEventListener('click', (e) => {
      if (moved) { moved = false; return; }
      if (e.target.closest('[data-stop]')) return;
      if (e.target.closest('[data-done]')) { doneSheet(id, onChange); return; }
      go(`#/c/${id}`);
    });
  });
}

// ---- 관리 완료 시트 ----
export async function doneSheet(id, onChange) {
  const c = await getCustomer(id);
  if (!c) return;
  const s = await getSettings();
  const cycle = s.cycles[c.grade] ?? 7;
  const t = today();
  const opt = (n) => `<small>${fmtShort(addDays(t, n))}</small>`;
  const { el, close } = openSheet(`
    <h2>${esc(c.name)} 관리 완료</h2>
    <p class="sheet-sub">오늘 접촉으로 기록하고 다음 관리일을 정합니다.</p>
    <div class="seg" style="margin-bottom:10px">${CONTACT_KINDS.slice(0, 4).map((k, i) => `<button data-kind="${k}" class="${i === 0 ? 'on' : ''}">${k}</button>`).join('')}</div>
    <div class="field"><input id="done-memo" placeholder="접촉 내용 (선택) 예: 84A 동호수 재문의" autocomplete="off"></div>
    <button class="btn btn-primary btn-block" data-n="${cycle}" style="min-height:58px;margin-bottom:8px;flex-direction:column;gap:0">
      <span>${esc(c.grade)}등급 기본 +${cycle}일</span><small style="font-weight:500;opacity:.85">${fmtShort(addDays(t, cycle))}</small></button>
    <div class="choice-grid">
      <button class="btn" data-n="1" style="flex-direction:column;gap:0">+1일${opt(1)}</button>
      <button class="btn" data-n="3" style="flex-direction:column;gap:0">+3일${opt(3)}</button>
      <button class="btn" data-n="7" style="flex-direction:column;gap:0">+7일${opt(7)}</button>
      <button class="btn" data-pick style="flex-direction:column;gap:0">직접 선택<small>날짜 고르기</small></button>
    </div>
    <div class="field hidden" id="pick-wrap" style="margin-top:10px">
      <input type="date" id="pick-date" min="${t}" value="${addDays(t, cycle)}">
      <button class="btn btn-primary btn-block" id="pick-ok" style="margin-top:8px">이 날짜로 지정</button>
    </div>`);
  let kind = '전화';
  el.querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => { kind = b.dataset.kind; el.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const finish = async (next) => {
    const prev = await getCustomer(id);
    const memo = el.querySelector('#done-memo').value.trim();
    await addHistory(id, { date: t, kind, text: memo ? `관리 완료 · ${memo}` : '관리 완료' }, { next });
    close();
    toast(`${c.name} · 다음 관리 ${fmtShort(next)}`, {
      label: '되돌리기',
      run: async () => { await db.put('customers', prev); onChange && onChange(); },
    });
    onChange && onChange();
  };
  el.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => finish(addDays(t, Number(b.dataset.n))); });
  el.querySelector('[data-pick]').onclick = () => el.querySelector('#pick-wrap').classList.remove('hidden');
  el.querySelector('#pick-ok').onclick = () => {
    const v = el.querySelector('#pick-date').value;
    if (v) finish(v);
  };
}

export function emptyState(emoji, title, body, btn) {
  return `<div class="empty"><div class="big">${emoji}</div><b>${esc(title)}</b><p>${esc(body)}</p>${btn || ''}</div>`;
}
