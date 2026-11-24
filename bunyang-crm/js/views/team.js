// 팀장 대시보드: 맨 위 숫자 4개(방문·입금·지연·이번 달 실적) → 오늘 시간표 + 확인 필요 → 이번 주 일정 → 직원별 현황(접힘)
import { getSettings } from '../db.js';
import { listCustomers, liveSchedule, liveHistory, missingDocs, liveDocs, isPayKind, patchCustomer, toggleSchedule } from '../store.js';
import { esc, today, addDays, ddayLabel, fmtShort, fmtMoney, relTime, uid } from '../utils.js';
import { icon, go, toast, siteTabs, bindSiteTabs, gradeBadge, ownerChip, emptyState } from '../ui.js';
import { staffName, sendAssignFile } from '../team.js';

const store = (k, area = 'sessionStorage') => ({
  get: () => { try { return window[area].getItem(k) || ''; } catch (e) { return ''; } },
  set: (v) => { try { window[area].setItem(k, v); } catch (e) { /* 무시 */ } },
});
const ss = store('teamStaff');
const staffOpen = store('teamStaffOpen', 'localStorage');

export async function render(el, ctx) {
  const s = await getSettings();
  const all = await listCustomers();
  const { html: tabs, filtered: bySite } = await siteTabs(all);
  let who = ss.get();
  if (who && who !== '-' && !s.staff.some((x) => x.id === who)) { who = ''; ss.set(''); }
  const list = who ? bySite.filter((c) => (who === '-' ? !c.owner : c.owner === who)) : bySite;
  const t = today(), tm = addDays(t, 1), wk = addDays(t, 7), month = t.slice(0, 7), mm = Number(month.slice(5));
  const owner = (c) => ownerChip(staffName(s, c.owner), !c.owner);
  const sum = (arr) => arr.reduce((n, { it }) => n + (Number(it.amount) || 0), 0);

  // ---- 집계 ----
  const items = [];
  list.forEach((c) => liveSchedule(c).forEach((it) => items.push({ c, it })));
  const isPay = ({ it }) => isPayKind(it.kind);
  const evType = (it) => (isPayKind(it.kind) ? 'pay' : 'contract');

  // 오늘 시간표: 방문 + 오늘 날짜 계약·입금 일정. 시간 없는 일정은 맨 위 '종일', 시간 미정 방문은 맨 아래
  const sortKey = (e) => e.time || (e.type === 'visit' ? '99' : '');
  const timeline = [
    ...items.filter(({ it }) => it.date === t).map(({ c, it }) => ({ type: evType(it), time: '', c, it, done: !!it.done })),
    ...list.filter((c) => c.visitDate === t).map((c) => ({ type: 'visit', time: c.visitTime || '', c, done: !!c.visitDone })),
  ].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const tomorrow = [
    ...list.filter((c) => c.visitDate === tm).map((c) => ({ type: 'visit', time: c.visitTime || '', c })),
    ...items.filter(({ it }) => it.date === tm && !it.done).map(({ c, it }) => ({ type: evType(it), time: '', c, it })),
  ].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const visitsToday = timeline.filter((e) => e.type === 'visit');
  const visitsTomorrow = tomorrow.filter((e) => e.type === 'visit').length;
  const payToday = items.filter((x) => isPay(x) && x.it.date === t);
  const payTodayLeft = payToday.filter(({ it }) => !it.done);
  const late = items.filter(({ it }) => !it.done && it.date && it.date < t).sort((a, b) => a.it.date.localeCompare(b.it.date));
  const payLate = late.filter(isPay);
  const week = items.filter(({ it }) => !it.done && it.date > t && it.date <= wk).sort((a, b) => a.it.date.localeCompare(b.it.date));

  // 이번 달 실적
  const inMonth = (d) => (d || '').startsWith(month);
  const mContract = items.filter(({ it }) => it.kind === '계약서 작성' && it.done && inMonth(it.doneDate || it.date)).length;
  const mVisit = list.reduce((n, c) => n + liveHistory(c).filter((h) => h.kind === '방문' && inMonth(h.date)).length, 0);
  const mNew = list.filter((c) => inMonth(c.firstDate)).length;
  const mPaid = items.filter(({ it }) => isPayKind(it.kind) && it.done && inMonth(it.doneDate));

  const docRows = list.filter((c) => liveDocs(c).length && missingDocs(c).length).sort((a, b) => missingDocs(b).length - missingDocs(a).length);
  const careOver = list.filter((c) => c.nextDate && c.nextDate < t).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const unassigned = bySite.filter((c) => !c.owner).length;
  const noReport = s.staff.filter((x) => !((s.staffSync[x.id] || {}).reportAt || '').startsWith(t));

  // ---- 조각 ----
  const TAG = { visit: '방문', pay: '입금', contract: '계약' };
  const action = (e) => {
    if (e.done) return `<span class="ok-txt">✓ ${e.type === 'visit' ? '방문함' : e.type === 'pay' ? '입금됨' : '완료'}</span>`;
    if (e.type === 'visit') return `<button class="btn btn-sm" data-visit="${e.c.id}">방문 확인</button>`;
    return `<button class="btn btn-sm btn-primary" data-sch="${e.c.id}|${e.it.id}">${e.type === 'pay' ? '입금 확인' : '완료'}</button>`;
  };
  const detail = (e) => (e.type === 'visit'
    ? [e.c.site, e.c.unitType && `${e.c.unitType} 관심`].filter(Boolean).join(' · ')
    : [e.it.kind, e.c.unit].filter(Boolean).join(' · '));
  const tlRow = (e) => `<div class="tl-row ${e.done ? 'done' : ''}" data-id="${e.c.id}">
      <span class="tl-time">${e.time ? esc(e.time) : e.type === 'visit' ? '미정' : '종일'}</span>
      <span class="ev-tag ${e.type}">${TAG[e.type]}</span>
      <span class="tl-main"><b>${esc(e.c.name)}</b> ${gradeBadge(e.c.grade)} <small>${esc(detail(e))}</small></span>
      <span class="tl-amt">${e.it?.amount ? esc(fmtMoney(e.it.amount)) : ''}</span>
      ${owner(e.c)}
      <span class="tl-act">${action(e)}</span></div>`;

  const lateRow = ({ c, it }) => `<div class="al-row danger" data-id="${c.id}">
      <span class="dd-txt over">${ddayLabel(it.date)}</span>
      <span class="al-main"><b>${esc(c.name)}</b> ${esc(it.kind)}${it.amount ? ` <b class="danger-txt">${esc(fmtMoney(it.amount))}</b>` : ''}</span>
      ${owner(c)}
      <button class="btn btn-sm" data-sch="${c.id}|${it.id}">${isPayKind(it.kind) ? '입금 확인' : '완료'}</button></div>`;

  const byOwner = (arr) => {
    const m = {};
    arr.forEach((c) => { const n = staffName(s, c.owner); m[n] = (m[n] || 0) + 1; });
    return Object.entries(m).map(([n, k]) => `${esc(n)} ${k}`).join(' · ');
  };
  const fold = (id, title, sub, body) => `<details class="al-fold" id="${id}">
      <summary class="al-row warn"><span class="al-main"><b>${title}</b> <small>${sub}</small></span><span class="chev">${icon('right', 'sm')}</span></summary>
      <div class="al-body">${body}</div></details>`;

  const alerts = [
    ...late.map(lateRow),
    noReport.length ? `<a class="al-row warn" href="#/sync"><span class="al-main"><b>오늘 보고 전</b> <small>${noReport.map((x) => esc(x.name)).join(' · ')}</small></span><span class="chev">${icon('right', 'sm')}</span></a>` : '',
    docRows.length ? fold('f-docs', `서류 미비 ${docRows.length}명`, byOwner(docRows),
      docRows.map((c) => `<a class="al-sub" href="#/c/${c.id}"><b>${esc(c.name)}</b>${owner(c)}<span class="tags">${missingDocs(c).map((d) => `<span class="tag">${esc(d.name)}</span>`).join('')}</span></a>`).join('')) : '',
    careOver.length ? fold('f-care', `관리 기한 지남 ${careOver.length}명`, byOwner(careOver),
      careOver.slice(0, 15).map((c) => `<a class="al-sub" href="#/c/${c.id}"><span class="dd-txt over">${ddayLabel(c.nextDate)}</span><b>${esc(c.name)}</b> ${gradeBadge(c.grade)}${owner(c)}</a>`).join('')
      + (careOver.length > 15 ? `<a class="more" href="#/customers">전체 ${careOver.length}명 보기</a>` : '')) : '',
    unassigned && who !== '-' ? `<button class="al-row warn" data-who="-"><span class="al-main"><b>담당 없는 손님 ${unassigned}명</b> <small>눌러서 보기</small></span><span class="chev">${icon('right', 'sm')}</span></button>` : '',
  ].filter(Boolean);

  const card = (label, num, sub, cls = '') => `<div class="kpi ${cls}"><span class="label">${label}</span><span class="num">${num}</span><span class="sub">${sub}</span></div>`;
  const vDone = visitsToday.filter((e) => e.done).length;
  const isOpen = staffOpen.get() === '1';

  el.innerHTML = `
    <div class="page-head"><h1>팀 현황 <span class="h-date">${fmtShort(t)}</span></h1>
      ${s.staff.length ? `<select class="who-select" id="who" aria-label="직원 선택">
        <option value="">전체 직원</option>${s.staff.map((x) => `<option value="${x.id}" ${who === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        ${unassigned ? `<option value="-" ${who === '-' ? 'selected' : ''}>미배정 (${unassigned})</option>` : ''}</select>` : ''}
      <a class="btn btn-sm" href="#/sync">${icon('swap', 'sm')} 파일 주고받기</a></div>
    ${tabs}
    ${!s.staff.length ? `<a class="card notice" href="#/settings">${icon('users', 'sm')} 설정에서 직원을 등록하면 손님을 배정하고 직원별 현황을 볼 수 있습니다</a>` : ''}

    <div class="kpis four">
      ${card('오늘 방문', `${visitsToday.length}<small>명</small>`, visitsToday.length ? `방문 확인 ${vDone} · 내일 ${visitsTomorrow}명` : `내일 ${visitsTomorrow}명`, visitsToday.length ? 'hl' : '')}
      ${card('오늘 입금', payToday.length ? esc(fmtMoney(sum(payToday))) : '없음', payToday.length ? `${payToday.length}건 · ${payTodayLeft.length ? `미확인 ${payTodayLeft.length}건` : '모두 확인'}` : '오늘 예정된 입금 없음', payTodayLeft.length ? 'ok' : '')}
      ${card('입금 지연', payLate.length ? esc(fmtMoney(sum(payLate))) : '없음', payLate.length ? `${payLate.length}건 · 확인 필요` : '늦어진 입금 없음', payLate.length ? 'danger' : '')}
      ${card(`${mm}월 실적`, `계약 ${mContract}<small>건</small>`, `방문 ${mVisit} · 신규 ${mNew} · 입금 ${fmtMoney(sum(mPaid)) || '0원'}`)}
    </div>

    <div class="dash-main">
      <section class="panel" id="p-today">
        <div class="panel-head">${icon('clock', 'sm')} 오늘 시간표 <span class="cnt">${timeline.length}</span></div>
        ${timeline.length ? `<div class="tl">${timeline.map(tlRow).join('')}</div>` : '<div class="panel-empty">오늘 잡힌 방문·입금·계약 일정이 없습니다</div>'}
        ${tomorrow.length ? `<div class="tl-next"><b>내일 ${fmtShort(tm)}</b>${tomorrow.map((e) => `<a href="#/c/${e.c.id}">${e.time ? `<span class="time">${esc(e.time)}</span> ` : ''}${esc(e.c.name)} <small>${e.type === 'visit' ? '방문' : esc(e.it.kind)} · ${esc(staffName(s, e.c.owner))}</small></a>`).join('')}</div>` : ''}
      </section>

      <div class="dash-side">
        <section class="panel ${late.length ? 'alert' : ''}" id="p-alert">
          <div class="panel-head">${icon('alert', 'sm')} 확인 필요 <span class="cnt">${alerts.length}</span></div>
          ${alerts.length ? `<div class="al">${alerts.join('')}</div>` : '<div class="panel-empty">밀린 일이 없습니다 👍</div>'}
        </section>

        <section class="panel" id="p-week">
          <div class="panel-head">${icon('won', 'sm')} 이번 주 계약·입금 <span class="cnt">${week.length}</span>
            ${week.some(isPay) ? `<span class="hint">입금 예정 ${esc(fmtMoney(sum(week.filter(isPay))))}</span>` : ''}</div>
          ${week.length ? `<div class="wk">${week.map(({ c, it }) => `<div class="wk-row" data-id="${c.id}">
              <span class="wk-d"><b>${fmtShort(it.date)}</b><small>${ddayLabel(it.date)}</small></span>
              <span class="al-main"><b>${esc(c.name)}</b> <span class="kind ${isPayKind(it.kind) ? 'pay' : ''}">${esc(it.kind)}</span></span>
              <span class="tl-amt">${esc(fmtMoney(it.amount))}</span>${owner(c)}</div>`).join('')}</div>`
          : '<div class="panel-empty">7일 안에 예정된 일정이 없습니다</div>'}
        </section>
      </div>
    </div>

    ${s.staff.length ? `<details class="panel staff-fold" id="p-staff" ${isOpen ? 'open' : ''}>
      <summary class="panel-head">${icon('users', 'sm')} 직원별 현황 <span class="hint">${noReport.length ? `<span class="danger-txt">보고 전 ${noReport.length}명</span> · ` : ''}<span class="fold-lbl">${isOpen ? '접기' : '펼치기'}</span></span></summary>
      ${table(['직원', '담당', `${mm}월 계약`, '오늘 방문', '입금 지연', '기한 지남', '서류 미비', '최근 보고', ''],
        [...s.staff.map((st) => staffRow(st, bySite.filter((c) => c.owner === st.id), s, t, month)),
          unassigned ? staffRow({ id: '-', name: '미배정' }, bySite.filter((c) => !c.owner), s, t, month) : ''])}
    </details>` : ''}
    ${!all.length ? emptyState('📋', '손님을 등록해 보세요', '+ 버튼으로 한 명씩 등록하거나, 파일 주고받기에서 엑셀(CSV) 명단을 한꺼번에 가져올 수 있습니다. 설정에서 샘플 데이터로 미리 볼 수도 있습니다.') : ''}`;

  // ---- 이벤트 ----
  bindSiteTabs(el, ctx.rerender);
  el.querySelector('#who')?.addEventListener('change', (e) => { ss.set(e.target.value); ctx.rerender(); });
  el.querySelectorAll('[data-who]').forEach((b) => { b.onclick = () => { ss.set(b.dataset.who); ctx.rerender(); }; });
  el.querySelectorAll('[data-id]').forEach((r) => {
    r.onclick = (e) => { if (!e.target.closest('button,a')) go(`#/c/${r.dataset.id}`); };
  });
  const sf = el.querySelector('#p-staff');
  sf?.addEventListener('toggle', () => {
    staffOpen.set(sf.open ? '1' : '0');
    const l = sf.querySelector('.fold-lbl');
    if (l) l.textContent = sf.open ? '접기' : '펼치기';
  });
  el.querySelectorAll('[data-visit]').forEach((b) => {
    b.onclick = async () => {
      await patchCustomer(b.dataset.visit, (c) => {
        c.visitDone = true; c.lastContact = t;
        c.history = [{ id: uid(), date: t, kind: '방문', text: '견본주택 방문 (팀장 확인)' }, ...(c.history || [])];
      });
      toast('방문 확인했습니다'); ctx.rerender();
    };
  });
  el.querySelectorAll('[data-sch]').forEach((b) => {
    b.onclick = async () => {
      const [cid, sid] = b.dataset.sch.split('|');
      await toggleSchedule(cid, sid, true);
      toast(`${b.textContent} 처리했습니다 · 다음 배정 파일에 반영됩니다`); ctx.rerender();
    };
  });
  el.querySelectorAll('[data-assign]').forEach((b) => {
    b.onclick = async () => {
      const n = await sendAssignFile(b.dataset.assign);
      toast(`배정 파일을 만들었습니다 (손님 ${n}명) · 카톡으로 보내주세요`); ctx.rerender();
    };
  });
  el.querySelectorAll('[data-staff]').forEach((b) => { b.onclick = () => { ss.set(b.dataset.staff); ctx.rerender(); window.scrollTo(0, 0); }; });
}

function table(head, rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function staffRow(st, mine, s, t, month) {
  const sch = [];
  mine.forEach((c) => liveSchedule(c).forEach((it) => sch.push(it)));
  const late = sch.filter((it) => !it.done && isPayKind(it.kind) && it.date && it.date < t).length;
  const contracts = sch.filter((it) => it.kind === '계약서 작성' && it.done && (it.doneDate || it.date || '').startsWith(month)).length;
  const over = mine.filter((c) => c.nextDate && c.nextDate < t).length;
  const sync = s.staffSync[st.id] || {};
  const reportOk = (sync.reportAt || '').startsWith(t);
  const n = (v, cls) => (v ? `<span class="${cls}">${v}</span>` : '<span class="zero">0</span>');
  return `<tr>
    <td><button class="link" data-staff="${st.id}"><b>${esc(st.name)}</b></button></td>
    <td class="num">${mine.length}</td>
    <td class="num">${n(contracts, 'accent-txt')}</td>
    <td class="num">${n(mine.filter((c) => c.visitDate === t).length, 'accent-txt')}</td>
    <td class="num">${n(late, 'danger-txt')}</td>
    <td class="num">${n(over, 'warn-txt')}</td>
    <td class="num">${n(mine.filter((c) => liveDocs(c).length && missingDocs(c).length).length, 'warn-txt')}</td>
    <td>${st.id === '-' ? '' : sync.reportAt ? `<span class="${reportOk ? 'ok-txt' : 'danger-txt'}">${relTime(sync.reportAt)}</span>` : '<span class="danger-txt">받은 적 없음</span>'}</td>
    <td>${st.id === '-' ? '<a class="btn btn-sm" href="#/customers">배정하기</a>' : `<button class="btn btn-sm" data-assign="${st.id}">${icon('download', 'sm')} 배정 파일</button>`}</td>
  </tr>`;
}
