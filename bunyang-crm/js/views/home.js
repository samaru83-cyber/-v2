// 홈 = 관리 대시보드
import { listCustomers } from '../store.js';
import { getSettings } from '../db.js';
import { bucketOf, weekRange, today, fmtShort, esc, addDays, ddayLabel, daysLeft, fmtMoney, relTime } from '../utils.js';
import { icon, siteTabs, bindSiteTabs, customerCard, bindCards, emptyState, toast } from '../ui.js';
import { liveSchedule, isPayKind, toggleSchedule } from '../store.js';
import { visibleCustomers, sendReportFile } from '../team.js';

const SECTIONS = [
  { key: 'overdue', title: '기한 지남', dot: 'over' },
  { key: 'today', title: '오늘', dot: 'today' },
  { key: 'soon', title: '3일 이내', dot: 'soon' },
  { key: 'later', title: '이후', dot: 'later', limit: 15 },
  { key: 'none', title: '관리일 미지정', dot: 'none', limit: 10 },
];
const expanded = new Set();
let bannerClosed = false;

export async function render(el, ctx) {
  const s = await getSettings();
  const all = visibleCustomers(await listCustomers(), s);
  const { html: tabs, filtered } = await siteTabs(all);
  const t = today();
  const [ws, we] = weekRange(t);

  const groups = { overdue: [], today: [], soon: [], later: [], none: [] };
  filtered.forEach((c) => groups[bucketOf(c.nextDate)].push(c));
  Object.values(groups).forEach((g) => g.sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || '') || a.name.localeCompare(b.name, 'ko')));
  const week = filtered.filter((c) => c.nextDate && c.nextDate >= ws && c.nextDate <= we).length;
  const nToday = groups.today.length, nOver = groups.overdue.length;

  const banner = (!bannerClosed && (nToday || nOver)) ? `
    <div class="banner">${icon('bell')}
      <div>오늘 관리할 고객 <b>${nToday}명</b>${nOver ? ` · 밀린 고객 <b>${nOver}명</b>` : ''}</div>
      <button class="x" aria-label="닫기" id="banner-x">${icon('x', 'sm')}</button></div>` : '';

  // 오늘·내일 방문 예약 + 계약·입금 일정(지연 + 7일 이내)
  const tm = addDays(t, 1), wk = addDays(t, 7);
  const visits = filtered.filter((c) => c.visitDate === t || c.visitDate === tm)
    .sort((a, b) => (a.visitDate + (a.visitTime || '99')).localeCompare(b.visitDate + (b.visitTime || '99')));
  const sched = [];
  filtered.forEach((c) => liveSchedule(c).forEach((it) => { if (!it.done && it.date && it.date <= wk) sched.push({ c, it }); }));
  sched.sort((a, b) => a.it.date.localeCompare(b.it.date));
  const agenda = (visits.length || sched.length) ? `
    <div class="agenda">
      ${visits.length ? `<section class="section"><div class="section-title">${icon('clock', 'sm')} 방문 예약<span class="cnt">${visits.length}</span></div>
        ${visits.map((c) => `<a class="ag-row ${c.visitDone ? 'muted' : ''}" href="#/c/${c.id}"><span class="ag-time ${c.visitDate === t ? 'today' : ''}">${c.visitDate === t ? '오늘' : '내일'}<b>${esc(c.visitTime || '미정')}</b></span>
          <span class="ag-body"><b>${esc(c.name)}</b><small>${esc([c.site, c.unitType].filter(Boolean).join(' · '))}</small></span>${c.visitDone ? '<span class="ok-txt">✓ 방문</span>' : ''}</a>`).join('')}</section>` : ''}
      ${sched.length ? `<section class="section"><div class="section-title">${icon('won', 'sm')} 계약·입금 일정<span class="cnt">${sched.length}</span></div>
        ${sched.map(({ c, it }) => { const n = daysLeft(it.date); return `<div class="ag-row" data-goto="${c.id}"><span class="ag-time ${n < 0 ? 'over' : n === 0 ? 'today' : ''}">${ddayLabel(it.date)}<b>${fmtShort(it.date).replace(/\(.\)/, '')}</b></span>
          <span class="ag-body"><b>${esc(c.name)} · ${esc(it.kind)}</b><small>${esc([c.unit, fmtMoney(it.amount)].filter(Boolean).join(' · '))}</small></span>
          <button class="btn btn-sm" data-sch="${c.id}|${it.id}">${isPayKind(it.kind) ? '입금 확인' : '완료'}</button></div>`; }).join('')}</section>` : ''}
    </div>` : '';
  const reportedToday = s.lastReportAt && s.lastReportAt.slice(0, 10) === t;
  const reportBanner = s.mode === 'staff' && !reportedToday && all.length ? `
    <div class="banner warn-banner">${icon('send')}<div>오늘 팀장님께 보고 전입니다${s.lastReportAt ? ` <small>(마지막 ${relTime(s.lastReportAt)})</small>` : ''}</div>
      <button class="btn btn-sm" id="report-now">보고 보내기</button></div>` : '';

  const greet = s.agentName ? `${esc(s.agentName)}님, ` : '';
  el.innerHTML = `
    <div class="page-head"><h1>관리 대시보드</h1><span class="sub">${fmtShort(t)}</span></div>
    ${tabs}
    ${reportBanner}
    ${banner}
    <div class="stats">
      <div class="stat today" data-jump="today"><div class="label">오늘 관리</div><div class="num">${nToday}</div></div>
      <div class="stat over" data-jump="overdue"><div class="label">기한 지남</div><div class="num">${nOver}</div></div>
      <div class="stat" data-jump="soon"><div class="label">이번 주</div><div class="num">${week}</div></div>
      <div class="stat" data-href="#/customers"><div class="label">전체 고객</div><div class="num">${filtered.length}</div></div>
    </div>
    ${agenda}
    <div id="secs"></div>`;

  const secs = el.querySelector('#secs');
  if (!all.length) {
    secs.innerHTML = emptyState('📋', `${greet}첫 고객을 등록해 보세요`, '+ 버튼으로 고객을 추가하면 관리일에 맞춰 여기에 정리됩니다. 설정에서 샘플 고객 10명을 넣어 미리 써볼 수도 있습니다.',
      `<div class="btn-row"><a class="btn btn-primary" href="#/new">고객 등록</a><a class="btn" href="#/settings">샘플 넣기</a></div>`);
  } else if (!nToday && !nOver && !groups.soon.length && !groups.later.length && !groups.none.length) {
    secs.innerHTML = emptyState('✅', '이 현장에는 고객이 없습니다', '현장 탭을 바꾸거나 고객을 추가하세요.');
  } else {
    secs.innerHTML = SECTIONS.map((sec) => {
      const list = groups[sec.key];
      if (!list.length) {
        if (sec.key === 'overdue' || sec.key === 'none' || sec.key === 'later') return '';
        return `<section class="section" id="sec-${sec.key}"><div class="section-title"><span class="dot ${sec.dot}"></span>${sec.title}<span class="cnt">0</span></div>
          <div style="color:var(--text-3);font-size:14px;padding:4px 2px 4px">${sec.key === 'today' ? '오늘 관리할 고객이 없습니다 👍' : '예정된 고객이 없습니다'}</div></section>`;
      }
      const lim = sec.limit && !expanded.has(sec.key) ? sec.limit : Infinity;
      return `<section class="section" id="sec-${sec.key}">
        <div class="section-title"><span class="dot ${sec.dot}"></span>${sec.title}<span class="cnt">${list.length}</span></div>
        ${list.slice(0, lim).map(customerCard).join('')}
        ${list.length > lim ? `<button class="more" data-more="${sec.key}">${list.length - lim}명 더 보기</button>` : ''}
      </section>`;
    }).join('') + `<p style="text-align:center;color:var(--text-3);font-size:12px;margin-top:4px">카드를 오른쪽으로 밀거나 ✓ 를 누르면 관리 완료</p>`;
  }

  bindCards(el, ctx.rerender);
  bindSiteTabs(el, ctx.rerender);
  el.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => { expanded.add(b.dataset.more); ctx.rerender(); }; });
  el.querySelectorAll('[data-jump]').forEach((b) => {
    b.onclick = () => {
      const target = el.querySelector(`#sec-${b.dataset.jump}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  el.querySelectorAll('[data-href]').forEach((b) => { b.onclick = () => { location.hash = b.dataset.href; }; });
  el.querySelectorAll('[data-goto]').forEach((r) => { r.onclick = (e) => { if (!e.target.closest('button')) location.hash = `#/c/${r.dataset.goto}`; }; });
  el.querySelectorAll('[data-sch]').forEach((b) => {
    b.onclick = async () => { const [cid, sid] = b.dataset.sch.split('|'); await toggleSchedule(cid, sid, true); toast(`${b.textContent} 처리했습니다`); ctx.rerender(); };
  });
  const rn = el.querySelector('#report-now');
  if (rn) rn.onclick = async () => { const n = await sendReportFile(); toast(`보고 파일을 만들었습니다 (손님 ${n}명)`); ctx.rerender(); };
  const bx = el.querySelector('#banner-x');
  if (bx) bx.onclick = () => { bannerClosed = true; ctx.rerender(); };
}
