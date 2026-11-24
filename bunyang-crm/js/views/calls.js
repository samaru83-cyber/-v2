// 콜 배분
// (팀장) 새 콜 입력 → 담당 직원 지정 / 처리 안 된 콜 / 직원별·콜 종류별 성과 / 콜 목록
// (직원) 받은 콜: 전화 걸고 결과 입력, 고객으로 등록
import { getSettings } from '../db.js';
import { listCalls, saveCall, deleteCall, findPhoneDup, stageOf, rankOf, RESULTS, resultLabel, convertToCustomer, periodStart, tally, customersById, isStale } from '../calls.js';
import { esc, today, fmtShort, relTime, formatPhone, digitsOnly, smsLink, debounce } from '../utils.js';
import { icon, go, toast, openSheet, confirmSheet, ownerChip, emptyState } from '../ui.js';
import { staffName } from '../team.js';

const ui = { period: 'month', who: '', kind: '', res: '', lastKind: '', staffTab: 'todo' };
const PERIODS = [['today', '오늘'], ['week', '이번 주'], ['month', '이번 달'], ['all', '전체']];
const md = (ymd) => (ymd ? `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}` : '');
const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');
const resCls = (k) => ({ '': 'todo', 부재: 'miss', 통화: 'reach', 방문예약: 'resv', 방문: 'visit', 계약: 'done', 무효: 'void' }[k || '']);
const resBadge = (k) => `<span class="res r-${resCls(k)}">${esc(resultLabel(k))}</span>`;

export async function render(el, ctx) {
  const s = await getSettings();
  const calls = await listCalls();
  const custById = await customersById();
  if (s.mode === 'staff') return renderStaff(el, ctx, s, calls, custById);
  return renderLead(el, ctx, s, calls, custById);
}

// =============================== 팀장 · 혼자 ===============================
function renderLead(el, ctx, s, calls, custById) {
  const lead = s.mode === 'lead' && s.staff.length > 0;
  const t = today();
  const kinds = s.callKinds?.length ? s.callKinds : ['콜'];
  if (!kinds.includes(ui.lastKind)) ui.lastKind = kinds[0];

  // 담당 추천: 오늘 받은 콜이 가장 적은 직원 (같으면 이번 달 적은 직원)
  const ms = t.slice(0, 7) + '-01';
  const cnt = (id, from) => calls.filter((c) => c.owner === id && c.date >= from).length;
  const ranked = [...s.staff].sort((a, b) => cnt(a.id, t) - cnt(b.id, t) || cnt(a.id, ms) - cnt(b.id, ms));
  const suggest = ranked[0]?.id || '';
  if (!s.staff.some((x) => x.id === ui.pick)) ui.pick = suggest;

  const from = periodStart(ui.period);
  const inPeriod = calls.filter((c) => !from || c.date >= from);
  const stale = calls.filter(isStale).sort((a, b) => a.at.localeCompare(b.at));
  const stage = (c) => stageOf(c, custById);

  // 성과표
  const statRow = (label, list, extra = '') => {
    const o = tally(list, custById);
    return `<tr${extra}><td><b>${label}</b></td><td class="num"><b>${o.n}</b></td>
      <td class="num">${o.todo ? `<span class="danger-txt">${o.todo}</span>` : '<span class="zero">0</span>'}</td>
      <td class="num">${o.reach}</td><td class="num accent-txt">${o.visit}</td><td class="num ok-txt">${o.contract}</td>
      <td class="num">${o.n - o.invalid ? `${o.visitRate}%` : '-'}</td><td class="num">${o.n - o.invalid ? `${o.contractRate}%` : '-'}</td></tr>`;
  };
  const statHead = (first) => `<thead><tr><th>${first}</th><th class="num">받은 콜</th><th class="num">미처리</th><th class="num">통화</th><th class="num">방문</th><th class="num">계약</th><th class="num">방문율</th><th class="num">계약율</th></tr></thead>`;
  const staffRows = s.staff.map((st) => statRow(`<button class="link" data-fwho="${st.id}">${esc(st.name)}</button>`, inPeriod.filter((c) => c.owner === st.id)));
  if (inPeriod.some((c) => !c.owner)) staffRows.push(statRow('미배정', inPeriod.filter((c) => !c.owner)));
  const kindNames = [...new Set([...kinds, ...inPeriod.map((c) => c.kind)])].filter((k) => inPeriod.some((c) => c.kind === k));
  const kindRows = kindNames.map((k) => statRow(`<button class="link" data-fkind="${esc(k)}">${esc(k)}</button>`, inPeriod.filter((c) => c.kind === k)));
  const total = statRow('합계', inPeriod, ' class="total"');

  // 목록 필터
  const list = inPeriod.filter((c) => (!ui.who || (ui.who === '-' ? !c.owner : c.owner === ui.who))
    && (!ui.kind || c.kind === ui.kind) && (!ui.res || (ui.res === 'todo' ? !c.result : stage(c) === ui.res)));
  const pLabel = PERIODS.find((p) => p[0] === ui.period)[1];

  el.innerHTML = `
    <div class="page-head"><h1>${lead ? '콜 배분' : '콜 기록'}</h1><span class="sub">${fmtShort(t)}</span></div>

    <section class="panel call-form">
      <div class="panel-head">${icon('phone', 'sm')} 새 콜 입력 <span class="hint">${lead ? '입력하면 바로 담당 직원 앞으로 기록됩니다' : '들어온 콜을 기록하세요'}</span></div>
      <div class="chips wrap" id="kinds">${kinds.map((k) => `<button type="button" class="chip ${k === ui.lastKind ? 'on' : ''}" data-kind="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <form id="cf" autocomplete="off">
        <div class="cf-grid">
          <input class="input" name="phone" inputmode="tel" placeholder="연락처 (필수)" aria-label="연락처" required>
          <input class="input" name="name" placeholder="이름 (모르면 비워두기)" aria-label="이름">
          <input class="input cf-memo" name="memo" placeholder="관심 평형·메모 (예: 84 관심, 저층 원함)" aria-label="메모">
        </div>
        <div class="cf-dup hidden" id="cdup"></div>
        ${lead ? `<div class="cf-owner"><span class="lbl">담당</span><div class="chips wrap" id="owners">${s.staff.map((st) => `<button type="button" class="chip ${st.id === ui.pick ? 'on' : ''}" data-owner="${st.id}">${esc(st.name)} <small>오늘 ${cnt(st.id, t)}</small>${st.id === suggest ? ' <small class="sug">적음</small>' : ''}</button>`).join('')}</div></div>` : ''}
        <button class="btn btn-primary cf-go" type="submit">${icon('send', 'sm')} ${lead ? '콜 주기' : '기록하기'}</button>
      </form>
      ${s.mode === 'lead' && !s.staff.length ? `<a class="card notice" href="#/settings" style="margin-top:10px">${icon('users', 'sm')} 설정에서 직원을 등록하면 콜을 직원에게 나눠줄 수 있습니다</a>` : ''}
    </section>

    ${stale.length ? `<section class="panel alert">
      <div class="panel-head">${icon('alert', 'sm')} 처리 안 된 콜 <span class="cnt">${stale.length}</span><span class="hint">준 지 하루 넘게 결과가 없는 콜</span></div>
      <div class="al">${stale.map((c) => `<div class="al-row danger" data-call="${c.id}">
        <span class="dd-txt over">${relTime(c.at)}</span>
        <span class="al-main"><b>${esc(c.name || '이름 미상')}</b> <small>${esc(c.kind)} · ${esc(c.phone)}</small></span>
        ${lead ? ownerChip(staffName(s, c.owner), !c.owner) : ''}<span class="chev">${icon('right', 'sm')}</span></div>`).join('')}</div>
      ${lead ? '<p class="panel-note">직원이 보고 파일을 보내야 결과가 들어옵니다. 오래된 콜은 눌러서 다른 직원에게 다시 줄 수 있습니다.</p>' : ''}
    </section>` : ''}

    <div class="chips period">${PERIODS.map(([k, l]) => `<button class="chip ${ui.period === k ? 'on' : ''}" data-period="${k}">${l}</button>`).join('')}</div>

    ${inPeriod.length ? `<div class="call-stats">
      ${lead ? `<section class="panel"><div class="panel-head">${icon('users', 'sm')} 직원별 성과 <span class="hint">${pLabel}</span></div>
        <div class="tbl-wrap"><table class="tbl cstat">${statHead('직원')}<tbody>${staffRows.join('')}${total}</tbody></table></div></section>` : ''}
      <section class="panel"><div class="panel-head">${icon('phone', 'sm')} 콜 종류별 성과 <span class="hint">${pLabel}</span></div>
        <div class="tbl-wrap"><table class="tbl cstat">${statHead('종류')}<tbody>${kindRows.join('')}${total}</tbody></table></div></section>
    </div>
    <p class="stat-note">방문·계약은 직원이 고른 결과와, 콜에서 등록한 고객 카드의 방문 확인·계약 중 앞선 것으로 셉니다. 방문율·계약율은 무효 콜을 뺀 비율입니다.</p>` : ''}

    <section class="panel">
      <div class="panel-head">${icon('note', 'sm')} 콜 목록 <span class="cnt">${list.length}</span><span class="hint">${pLabel}</span></div>
      <div class="list-filter">
        ${lead ? `<select class="input sm-in" id="f-who"><option value="">전체 직원</option>${s.staff.map((x) => `<option value="${x.id}" ${ui.who === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="-" ${ui.who === '-' ? 'selected' : ''}>미배정</option></select>` : ''}
        <select class="input sm-in" id="f-kind"><option value="">전체 종류</option>${kindNames.concat(ui.kind && !kindNames.includes(ui.kind) ? [ui.kind] : []).map((k) => `<option ${ui.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <select class="input sm-in" id="f-res"><option value="">전체 결과</option><option value="todo" ${ui.res === 'todo' ? 'selected' : ''}>미처리</option>${RESULTS.filter((r) => r.k).map((r) => `<option value="${r.k}" ${ui.res === r.k ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
        ${ui.who || ui.kind || ui.res ? '<button class="btn btn-sm" id="f-clear">필터 해제</button>' : ''}
      </div>
      ${list.length ? `<div class="call-list">${list.slice(0, 300).map((c) => {
        const st = stage(c);
        return `<div class="cl-row ${st === '무효' ? 'void' : ''}" data-call="${c.id}">
          <span class="cl-when"><b>${c.date === t ? '오늘' : md(c.date)}</b><small>${hhmm(c.at)}</small></span>
          <span class="kind">${esc(c.kind)}</span>
          <span class="cl-main"><b>${esc(c.name || '이름 미상')}</b> <small>${esc(c.phone)}</small>${c.memo ? `<em>${esc(c.memo)}</em>` : ''}</span>
          ${lead ? ownerChip(staffName(s, c.owner), !c.owner) : ''}
          ${resBadge(st)}${c.customerId && custById.has(c.customerId) ? '<span class="cl-linked" title="고객 카드 있음">고객</span>' : '<span class="cl-linked"></span>'}</div>`;
      }).join('')}</div>${list.length > 300 ? '<p class="panel-note">최근 300건만 보입니다. 기간이나 필터를 좁혀 보세요.</p>' : ''}`
      : `<div class="panel-empty">${calls.length ? '조건에 맞는 콜이 없습니다' : '아직 입력한 콜이 없습니다. 위에서 첫 콜을 입력해 보세요.'}</div>`}
    </section>`;

  // ---- 입력 ----
  const f = el.querySelector('#cf');
  const dupEl = el.querySelector('#cdup');
  el.querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => { ui.lastKind = b.dataset.kind; el.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  el.querySelectorAll('[data-owner]').forEach((b) => {
    b.onclick = () => { ui.pick = b.dataset.owner; el.querySelectorAll('[data-owner]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const checkDup = debounce(async () => {
    const { calls: dc, customer } = await findPhoneDup(f.phone.value);
    const msg = [];
    if (dc.length) { const d = dc[0]; msg.push(`이미 받은 콜입니다: ${fmtShort(d.date)} ${esc(d.kind)} → ${esc(staffName(s, d.owner))}${dc.length > 1 ? ` 외 ${dc.length - 1}건` : ''}`); }
    if (customer) msg.push(`이미 고객입니다: <a href="#/c/${customer.id}">${esc(customer.name)}</a> (${esc(staffName(s, customer.owner))} 담당)`);
    dupEl.innerHTML = msg.join('<br>');
    dupEl.classList.toggle('hidden', !msg.length);
  }, 250);
  f.phone.addEventListener('input', () => {
    const v = formatPhone(f.phone.value);
    if (v !== f.phone.value) f.phone.value = v;
    checkDup();
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (digitsOnly(f.phone.value).length < 9) { toast('연락처를 확인해 주세요'); f.phone.focus(); return; }
    const owner = lead ? ui.pick : '';
    const rec = await saveCall({ kind: ui.lastKind, phone: f.phone.value, name: f.name.value.trim(), memo: f.memo.value.trim(), owner });
    ui.pick = '';
    toast(lead ? `${staffName(s, owner)}에게 ${rec.kind}을 줬습니다` : '콜을 기록했습니다');
    await ctx.rerender();
    el.querySelector('#cf')?.phone.focus();
  };

  // ---- 필터·목록 ----
  el.querySelectorAll('[data-period]').forEach((b) => { b.onclick = () => { ui.period = b.dataset.period; ctx.rerender(); }; });
  el.querySelector('#f-who')?.addEventListener('change', (e) => { ui.who = e.target.value; ctx.rerender(); });
  el.querySelector('#f-kind').onchange = (e) => { ui.kind = e.target.value; ctx.rerender(); };
  el.querySelector('#f-res').onchange = (e) => { ui.res = e.target.value; ctx.rerender(); };
  el.querySelector('#f-clear')?.addEventListener('click', () => { ui.who = ''; ui.kind = ''; ui.res = ''; ctx.rerender(); });
  el.querySelectorAll('[data-fwho]').forEach((b) => { b.onclick = () => { ui.who = b.dataset.fwho; ui.kind = ''; ctx.rerender(); }; });
  el.querySelectorAll('[data-fkind]').forEach((b) => { b.onclick = () => { ui.kind = b.dataset.fkind; ui.who = ''; ctx.rerender(); }; });
  bindCallRows(el, ctx, s, calls, custById);
}

// =============================== 직원 ===============================
function renderStaff(el, ctx, s, calls, custById) {
  const mine = calls.filter((c) => !c.owner || c.owner === s.me?.id);
  const stage = (c) => stageOf(c, custById);
  const todo = mine.filter((c) => rankOf(c.result) <= 1 && c.result !== '무효');
  const doneL = mine.filter((c) => !todo.includes(c));
  const shown = ui.staffTab === 'todo' ? todo : ui.staffTab === 'done' ? doneL : mine;
  const o = tally(mine.filter((c) => c.date >= today().slice(0, 7) + '-01'), custById);

  el.innerHTML = `
    <div class="page-head"><h1>받은 콜</h1><span class="sub">이번 달 ${o.n}건 · 방문 ${o.visit} · 계약 ${o.contract}</span></div>
    <div class="seg" id="stab">
      <button class="${ui.staffTab === 'todo' ? 'on' : ''}" data-t="todo">처리 전 ${todo.length}</button>
      <button class="${ui.staffTab === 'done' ? 'on' : ''}" data-t="done">처리함 ${doneL.length}</button>
      <button class="${ui.staffTab === 'all' ? 'on' : ''}" data-t="all">전체 ${mine.length}</button>
    </div>
    <div class="call-cards">
      ${shown.length ? shown.map((c) => `<div class="call-card ${isStale(c) ? 'stale' : ''}" data-call="${c.id}">
          <div class="cc-top"><span class="kind">${esc(c.kind)}</span><span class="cc-when">${relTime(c.at)} ${hhmm(c.at)}</span>${resBadge(stage(c))}</div>
          <div class="cc-name"><b>${esc(c.name || '이름 미상')}</b> <span>${esc(c.phone)}</span></div>
          ${c.memo ? `<div class="cc-memo">${esc(c.memo)}</div>` : ''}
          <div class="cc-act">
            <a class="btn btn-sm" href="tel:${digitsOnly(c.phone)}">${icon('phone', 'sm')} 전화</a>
            <a class="btn btn-sm" href="${smsLink(c.phone)}">${icon('message', 'sm')} 문자</a>
            <button class="btn btn-sm btn-primary" data-open="${c.id}">결과 입력</button>
          </div></div>`).join('')
      : emptyState('📞', ui.staffTab === 'todo' ? '처리할 콜이 없습니다' : '콜이 없습니다', '팀장님이 준 콜은 배정 파일을 불러오면 여기에 들어옵니다. 통화 후 결과를 입력하고, 보고 파일을 보내면 팀장님 화면에 반영됩니다.')}
    </div>`;
  el.querySelectorAll('#stab [data-t]').forEach((b) => { b.onclick = () => { ui.staffTab = b.dataset.t; ctx.rerender(); }; });
  bindCallRows(el, ctx, s, calls, custById);
}

function bindCallRows(el, ctx, s, calls, custById) {
  el.querySelectorAll('[data-call]').forEach((r) => {
    r.onclick = (e) => {
      if (e.target.closest('a,button:not([data-open])')) return;
      const c = calls.find((x) => x.id === r.dataset.call);
      if (c) callSheet(c, s, custById, ctx.rerender);
    };
  });
}

// =============================== 콜 상세 시트 ===============================
function callSheet(c, s, custById, onChange) {
  const lead = s.mode === 'lead';
  const staff = s.mode === 'staff';
  const cust = c.customerId && custById.get(c.customerId);
  const st = stageOf(c, custById);
  let res = c.result || '';
  const { el, close } = openSheet(`
    <h2>${esc(c.name || '이름 미상')} <span class="kind">${esc(c.kind)}</span></h2>
    <p class="sheet-sub">${esc(c.phone)} · ${fmtShort(c.date)} ${hhmm(c.at)}${lead ? ` · ${esc(staffName(s, c.owner))}` : ''}</p>
    <div class="btn-row" style="margin-bottom:14px">
      <a class="btn" href="tel:${digitsOnly(c.phone)}">${icon('phone', 'sm')} 전화</a>
      <a class="btn" href="${smsLink(c.phone)}">${icon('message', 'sm')} 문자</a></div>
    <div class="field"><label>결과</label>
      <div class="seg res-seg" id="cs-res">${RESULTS.map((r) => `<button type="button" class="${res === r.k ? 'on' : ''}" data-r="${r.k}">${r.label}</button>`).join('')}</div>
      ${st !== res && cust ? `<div class="hint">고객 카드 기준으로는 <b>${esc(resultLabel(st))}</b>까지 진행되어 성과에 그렇게 반영됩니다</div>` : ''}</div>
    <div class="field"><label>이름</label><input id="cs-name" value="${esc(c.name || '')}" placeholder="이름"></div>
    ${!staff ? `<div class="field"><label>콜 종류</label><select id="cs-kind">${[...new Set([...(s.callKinds || []), c.kind])].filter(Boolean).map((k) => `<option ${k === c.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></div>` : ''}
    ${lead ? `<div class="field"><label>담당 직원</label><select id="cs-owner"><option value="">미배정</option>${s.staff.map((x) => `<option value="${x.id}" ${x.id === c.owner ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="hint">다른 직원에게 넘기면 다음 배정 파일부터 그 직원 폰으로 갑니다</div></div>` : ''}
    <div class="field"><label>메모</label><textarea id="cs-memo" placeholder="통화 내용, 관심 평형 등">${esc(c.memo || '')}</textarea></div>
    <div class="btn-row">
      ${cust ? `<a class="btn" href="#/c/${cust.id}">고객 카드 보기</a>` : `<button class="btn" id="cs-conv">${icon('plus', 'sm')} 고객으로 등록</button>`}
      <button class="btn btn-primary" id="cs-save">저장</button></div>
    ${!staff || !c.synced ? '<div style="text-align:center;margin-top:12px"><button class="link danger-txt" id="cs-del">이 콜 삭제</button></div>' : ''}`);

  el.querySelectorAll('#cs-res [data-r]').forEach((b) => {
    b.onclick = () => { res = b.dataset.r; el.querySelectorAll('#cs-res [data-r]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const collect = () => ({
    ...c, result: res, resultAt: res !== (c.result || '') ? new Date().toISOString() : c.resultAt || '',
    name: el.querySelector('#cs-name').value.trim(), memo: el.querySelector('#cs-memo').value.trim(),
    kind: el.querySelector('#cs-kind')?.value || c.kind,
    owner: el.querySelector('#cs-owner') ? el.querySelector('#cs-owner').value : c.owner,
  });
  el.querySelector('#cs-save').onclick = async () => {
    const rec = await saveCall(collect());
    close();
    if (!rec.customerId && rankOf(rec.result) >= 2) {
      toast(`${resultLabel(rec.result)}으로 저장했습니다`, { label: '고객 등록', run: async () => { const cu = await convertToCustomer(rec, s); go(`#/c/${cu.id}`); } });
    } else toast('저장했습니다');
    onChange();
  };
  el.querySelector('#cs-conv')?.addEventListener('click', async () => {
    const data = collect();
    const rec = await saveCall(data);
    const cu = await convertToCustomer(rec, s);
    close();
    toast(`${cu.name} 고객 카드를 만들었습니다 · 방문 예약을 잡아보세요`);
    go(`#/c/${cu.id}`);
  });
  el.querySelector('#cs-del')?.addEventListener('click', async () => {
    close();
    if (!(await confirmSheet({ title: '이 콜을 삭제할까요?', message: '콜 기록과 성과 집계에서 빠집니다. 고객 카드는 남습니다.', ok: '삭제', danger: true }))) return;
    await deleteCall(c.id);
    toast('콜을 삭제했습니다'); onChange();
  });
}
