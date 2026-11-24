// 월간 캘린더: 날짜별 방문 예약 · 계약/입금 · 관리 예정. PC에서는 칸 안에 이름까지 표시
import { getSettings } from '../db.js';
import { listCustomers, eventsOf } from '../store.js';
import { today, toYMD, parseYMD, fmtShort, esc, fmtMoney, isWide } from '../utils.js';
import { icon, siteTabs, bindSiteTabs, customerCard, bindCards, ownerChip } from '../ui.js';
import { visibleCustomers, staffName } from '../team.js';

const st = { ym: null, sel: null };
const TYPE = { visit: '방문', pay: '입금', contract: '계약', care: '관리' };

export async function render(el, ctx) {
  const t = today();
  if (!st.ym) st.ym = t.slice(0, 7);
  if (!st.sel) st.sel = t;
  const s = await getSettings();
  const lead = s.mode === 'lead';
  const all = visibleCustomers(await listCustomers(), s);
  const { html: tabs, filtered } = await siteTabs(all);
  const wide = isWide();

  const byDate = {};
  filtered.forEach((c) => eventsOf(c).forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); }));
  const order = { visit: 0, pay: 1, contract: 2, care: 3 };
  Object.values(byDate).forEach((l) => l.sort((a, b) => order[a.type] - order[b.type] || (a.time || '').localeCompare(b.time || '')));

  const [y, m] = st.ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    cells.push(d);
  }

  const dayCell = (d) => {
    const ymd = toYMD(d);
    const ev = byDate[ymd] || [];
    const cnt = (type) => ev.filter((e) => e.type === type && !e.done).length;
    const cls = ['day', d.getMonth() !== m - 1 && 'out', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat', ymd === t && 'today', ymd === st.sel && 'sel'].filter(Boolean).join(' ');
    const past = ymd < t;
    let inner;
    if (wide) {
      const shown = ev.filter((e) => !(e.type === 'care' && e.done));
      inner = shown.slice(0, 4).map((e) => `<span class="ev ${e.type}${e.done ? ' done' : ''}${past && !e.done && e.type !== 'visit' ? ' late' : ''}">${e.time ? `${esc(e.time)} ` : ''}${esc(e.c.name)}${e.type === 'care' ? '' : ` ${esc(e.type === 'visit' ? '방문' : e.label)}`}</span>`).join('')
        + (shown.length > 4 ? `<span class="ev more">+${shown.length - 4}</span>` : '');
    } else {
      inner = `<span class="dots">${['visit', 'pay', 'contract'].map((tp) => (cnt(tp) ? `<i class="dot-${tp}"></i>` : '')).join('')}</span>${cnt('care') ? `<span class="c ${past ? 'over' : ''}">${cnt('care')}</span>` : ''}`;
    }
    return `<button class="${cls}" data-d="${ymd}" aria-label="${fmtShort(ymd)} 일정 ${ev.length}건"><span class="n">${d.getDate()}</span>${inner}</button>`;
  };

  const selEv = byDate[st.sel] || [];
  const monthEv = Object.entries(byDate).filter(([d]) => d.startsWith(st.ym)).flatMap(([, v]) => v);
  const mc = (tp) => monthEv.filter((e) => e.type === tp).length;
  const evRow = (e) => `<a class="ag-row ${e.done ? 'muted' : ''}" href="#/c/${e.c.id}">
      <span class="ev-tag ${e.type}">${TYPE[e.type]}</span>
      <span class="ag-body"><b>${e.time ? esc(e.time) + ' ' : ''}${esc(e.c.name)}${e.type !== 'visit' ? ` · ${esc(e.label)}` : ''}</b>
        <small>${esc([e.c.site, e.c.unit || e.c.unitType, fmtMoney(e.amount)].filter(Boolean).join(' · '))}</small></span>
      ${lead ? ownerChip(staffName(s, e.c.owner), !e.c.owner) : ''}${e.done ? '<span class="ok-txt">✓</span>' : ''}</a>`;
  const careList = selEv.filter((e) => e.type === 'care').map((e) => e.c);
  const otherEv = selEv.filter((e) => e.type !== 'care');

  el.innerHTML = `
    <div class="page-head"><h1>캘린더</h1><button class="btn btn-sm" id="today">오늘</button></div>
    ${tabs}
    <div class="cal-layout">
    <div>
      <div class="cal-head">
        <button class="icon-btn" id="prev" aria-label="이전 달">${icon('left')}</button>
        <div style="text-align:center"><div class="title">${y}년 ${m}월</div>
          <div class="legend"><span><i class="dot-visit"></i>방문 ${mc('visit')}</span><span><i class="dot-pay"></i>입금 ${mc('pay')}</span><span><i class="dot-contract"></i>계약·서류 ${mc('contract')}</span><span><i class="dot-care"></i>관리 ${mc('care')}</span></div></div>
        <button class="icon-btn" id="next" aria-label="다음 달">${icon('right')}</button>
      </div>
      <div class="cal ${wide ? 'wide' : ''}" id="cal">
        ${['일', '월', '화', '수', '목', '금', '토'].map((w, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
        ${cells.map(dayCell).join('')}
      </div>
    </div>
    <div>
      <div class="section-title">${fmtShort(st.sel)}${st.sel === t ? ' · 오늘' : ''} <span class="cnt">${selEv.length}건</span></div>
      ${otherEv.length ? `<div class="section">${otherEv.map(evRow).join('')}</div>` : ''}
      ${careList.length ? `<div class="section-title" style="font-size:14px">관리 예정 <span class="cnt">${careList.length}</span></div>
        ${wide ? selEv.filter((e) => e.type === 'care').map(evRow).join('')
          : `<div id="sel">${careList.map((c) => customerCard(c, lead ? { owner: staffName(s, c.owner) } : {})).join('')}</div>`}` : ''}
      ${!selEv.length ? '<div style="color:var(--text-3);font-size:14px;padding:6px 2px 20px">이 날 일정이 없습니다</div>' : ''}
    </div>
    </div>`;

  const shift = (k) => { const d = parseYMD(st.ym + '-01'); d.setMonth(d.getMonth() + k); st.ym = toYMD(d).slice(0, 7); ctx.rerender(); };
  el.querySelector('#prev').onclick = () => shift(-1);
  el.querySelector('#next').onclick = () => shift(1);
  el.querySelector('#today').onclick = () => { st.ym = t.slice(0, 7); st.sel = t; ctx.rerender(); };
  el.querySelectorAll('[data-d]').forEach((b) => {
    b.onclick = () => { st.sel = b.dataset.d; if (!st.sel.startsWith(st.ym)) st.ym = st.sel.slice(0, 7); ctx.rerender(); };
  });
  const cal = el.querySelector('#cal');
  let sx = null;
  cal.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  cal.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
  });
  const sel = el.querySelector('#sel');
  if (sel) bindCards(sel, ctx.rerender);
  bindSiteTabs(el, ctx.rerender);
}
