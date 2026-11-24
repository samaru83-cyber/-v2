// 고객 목록: 통합 검색, 등급·유입경로·담당 필터, 정렬, 현장 탭, (팀장) 일괄 배정
import { getSettings, db } from '../db.js';
import { listCustomers, liveHistory } from '../store.js';
import { esc, digitsOnly, GRADES, SOURCES, debounce, fmtShort, nowISO, isWide } from '../utils.js';
import { icon, go, toast, siteTabs, bindSiteTabs, ddayBadge, gradeBadge, ownerChip, emptyState } from '../ui.js';
import { visibleCustomers, staffName } from '../team.js';

const KEY = 'listFilter';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const save = (f) => { try { sessionStorage.setItem(KEY, JSON.stringify(f)); } catch (e) { /* 무시 */ } };

export async function render(el, ctx) {
  const s = await getSettings();
  const lead = s.mode === 'lead';
  const all = visibleCustomers(await listCustomers(), s);
  const { html: tabs, filtered: bySite } = await siteTabs(all);
  const f = { q: '', grade: '', source: '', owner: '', sort: 'next', ...load() };
  const selected = new Set();

  el.innerHTML = `
    <div class="page-head"><h1>고객</h1><span class="sub">${all.length}명</span>
      ${isWide() ? `<a class="btn btn-sm btn-primary" href="#/new">${icon('plus', 'sm')} 고객 등록</a>` : ''}</div>
    ${tabs}
    <div class="list-tools">
      <div class="search">${icon('search')}<input id="q" type="search" placeholder="이름, 번호, 메모, 태그 검색" value="${esc(f.q)}" autocomplete="off"></div>
      <div class="filters ${lead ? 'four' : ''}">
        <select id="f-grade" aria-label="등급"><option value="">등급 전체</option>${GRADES.map((g) => `<option ${f.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <select id="f-source" aria-label="유입경로"><option value="">유입 전체</option>${SOURCES.map((x) => `<option ${f.source === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        ${lead ? `<select id="f-owner" aria-label="담당"><option value="">담당 전체</option><option value="-" ${f.owner === '-' ? 'selected' : ''}>미배정</option>${s.staff.map((x) => `<option value="${x.id}" ${f.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
        <select id="f-sort" aria-label="정렬">
          <option value="next" ${f.sort === 'next' ? 'selected' : ''}>관리일순</option>
          <option value="recent" ${f.sort === 'recent' ? 'selected' : ''}>최근등록순</option>
          <option value="grade" ${f.sort === 'grade' ? 'selected' : ''}>등급순</option>
          <option value="name" ${f.sort === 'name' ? 'selected' : ''}>이름순</option>
        </select>
      </div>
    </div>
    <div class="bulk hidden" id="bulk">
      <b id="bulk-n"></b>
      <select id="bulk-owner"><option value="">담당 직원 선택</option><option value="-">미배정으로</option>${s.staff.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" id="bulk-go">배정</button>
      <button class="btn btn-sm" id="bulk-x">선택 해제</button>
    </div>
    <div id="results"></div>`;

  const results = el.querySelector('#results');
  const bulk = el.querySelector('#bulk');
  const updBulk = () => {
    bulk.classList.toggle('hidden', !selected.size);
    el.querySelector('#bulk-n').textContent = `${selected.size}명 선택`;
  };

  let current = [];
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const qd = digitsOnly(q);
    let list = bySite.filter((c) => {
      if (f.grade && c.grade !== f.grade) return false;
      if (f.source && c.source !== f.source) return false;
      if (lead && f.owner && (f.owner === '-' ? c.owner : c.owner !== f.owner)) return false;
      if (!q) return true;
      if (qd.length >= 3 && (c.phoneDigits || '').includes(qd)) return true;
      const hay = [c.name, c.memo, c.unitType, c.unit, c.site, lead ? staffName(s, c.owner) : '', ...(c.tags || []), ...liveHistory(c).map((h) => h.text)].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const gi = (g) => { const i = GRADES.indexOf(g); return i < 0 ? 99 : i; };
    const sorters = {
      next: (a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999'),
      recent: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
      grade: (a, b) => gi(a.grade) - gi(b.grade) || (a.nextDate || '9999').localeCompare(b.nextDate || '9999'),
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    };
    list = list.sort(sorters[f.sort] || sorters.next);
    current = list;

    if (!all.length) {
      results.innerHTML = emptyState('👋', '첫 고객을 등록해 보세요', '+ 버튼으로 고객을 추가하거나, 설정에서 샘플 고객을 넣어볼 수 있습니다.',
        `<a class="btn btn-primary" href="#/new">${icon('plus')} 고객 등록</a>`);
      return;
    }
    if (!list.length) { results.innerHTML = emptyState('🔍', '검색 결과가 없습니다', '검색어나 필터를 바꿔 보세요.'); return; }

    if (isWide()) {
      // PC: 표
      results.innerHTML = `<div class="list-count">${list.length}명</div>
        <div class="tbl-wrap panel" style="padding:0"><table class="tbl clickable"><thead><tr>
          ${lead ? '<th style="width:36px"><input type="checkbox" id="all-chk" aria-label="전체 선택"></th>' : ''}
          <th>관리일</th><th>이름</th><th>연락처</th><th>현장 · 타입</th>${lead ? '<th>담당</th>' : ''}<th>유입</th><th>최근 접촉</th><th>방문 예약</th><th>메모</th></tr></thead><tbody>
          ${list.map((c) => `<tr data-id="${c.id}">
            ${lead ? `<td><input type="checkbox" data-chk="${c.id}" ${selected.has(c.id) ? 'checked' : ''}></td>` : ''}
            <td>${ddayBadge(c.nextDate, true)}</td><td><b>${esc(c.name)}</b> ${gradeBadge(c.grade)}</td><td>${esc(c.phone)}</td>
            <td>${esc([c.site, c.unitType, c.unit].filter(Boolean).join(' · '))}</td>
            ${lead ? `<td>${ownerChip(staffName(s, c.owner), !c.owner)}</td>` : ''}
            <td>${esc(c.source || '')}</td><td class="sm">${c.lastContact ? fmtShort(c.lastContact) : '-'}</td>
            <td class="sm">${c.visitDate ? `${fmtShort(c.visitDate)} ${esc(c.visitTime || '')}` : ''}</td>
            <td class="sm ellipsis">${esc((liveHistory(c)[0] || {}).text || c.memo || '')}</td></tr>`).join('')}
        </tbody></table></div>`;
    } else {
      results.innerHTML = `<div class="list-count">${list.length}명</div>` + list.map((c) => `
        <div class="row" data-id="${c.id}">
          <div class="body">
            <div class="name">${esc(c.name)} ${gradeBadge(c.grade)}${lead ? ownerChip(staffName(s, c.owner), !c.owner) : ''}</div>
            <div class="meta">${esc(c.phone)}${c.site ? ' · ' + esc(c.site) : ''}${c.unitType ? ' · ' + esc(c.unitType) : ''}</div>
          </div>
          ${ddayBadge(c.nextDate, true)}
        </div>`).join('');
    }
    results.querySelectorAll('[data-id]').forEach((r) => {
      r.onclick = (e) => { if (!e.target.closest('input')) go(`#/c/${r.dataset.id}`); };
    });
    results.querySelectorAll('[data-chk]').forEach((b) => {
      b.onchange = () => { b.checked ? selected.add(b.dataset.chk) : selected.delete(b.dataset.chk); updBulk(); };
    });
    const ac = results.querySelector('#all-chk');
    if (ac) ac.onchange = () => { current.forEach((c) => (ac.checked ? selected.add(c.id) : selected.delete(c.id))); draw(); updBulk(); };
  };

  el.querySelector('#bulk-x').onclick = () => { selected.clear(); draw(); updBulk(); };
  el.querySelector('#bulk-go').onclick = async () => {
    const v = el.querySelector('#bulk-owner').value;
    if (!v) { toast('담당 직원을 고르세요'); return; }
    const owner = v === '-' ? '' : v;
    const now = nowISO();
    const recs = (await listCustomers()).filter((c) => selected.has(c.id)).map((c) => ({ ...c, owner, updatedAt: now }));
    await db.putMany('customers', recs);
    toast(`${recs.length}명을 ${owner ? staffName(s, owner) : '미배정'}(으)로 배정했습니다 · 배정 파일을 다시 보내주세요`);
    ctx.rerender();
  };

  const onQ = debounce(() => { f.q = el.querySelector('#q').value; save(f); draw(); }, 150);
  el.querySelector('#q').addEventListener('input', onQ);
  ['grade', 'source', 'owner', 'sort'].forEach((k) => {
    const sel = el.querySelector(`#f-${k}`);
    if (sel) sel.onchange = (e) => { f[k] = e.target.value; save(f); draw(); };
  });
  bindSiteTabs(el, ctx.rerender);
  draw();
}
