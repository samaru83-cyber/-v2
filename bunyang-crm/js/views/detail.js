// 고객 상세: 전화/문자, 관리 완료, 방문 예약, 계약 일정, 서류, 접촉 기록, 히스토리
import { getSettings } from '../db.js';
import {
  getCustomer, addHistory, removeHistory, deleteCustomer, patchCustomer, liveHistory, liveSchedule,
  upsertSchedule, toggleSchedule, removeSchedule, initDocs, toggleDoc, addDoc, removeDoc, liveDocs, isPayKind,
} from '../store.js';
import { esc, fmtDate, fmtShort, today, addDays, daysLeft, diffDays, ddayLabel, CONTACT_KINDS, SCHEDULE_KINDS, smsLink, fmtMoney, uid } from '../utils.js';
import { icon, go, toast, confirmSheet, openSheet, doneSheet, ddayBadge, gradeBadge } from '../ui.js';
import { staffName } from '../team.js';
import { composeSheet } from './sms.js';

export async function render(el, ctx) {
  const c = await getCustomer(ctx.params[0]);
  if (!c) { el.innerHTML = '<p class="empty">고객을 찾을 수 없습니다.</p>'; return; }
  const s = await getSettings();
  const lead = s.mode === 'lead';
  const t = today();
  const cycle = s.cycles[c.grade] ?? 7;
  const n = daysLeft(c.nextDate);
  const since = c.lastContact ? diffDays(c.lastContact, t) : null;
  const hist = liveHistory(c);
  const sched = liveSchedule(c);
  const docs = liveDocs(c);
  const canDelete = !(s.mode === 'staff' && c.synced);
  const showContract = c.grade === '계약' || sched.length || docs.length;

  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  const vd = c.visitDate ? daysLeft(c.visitDate) : null;

  el.innerHTML = `
    <div class="page-head">
      <button class="icon-btn back" aria-label="뒤로" id="back">${icon('left')}</button>
      <h1 style="font-size:18px">고객 상세</h1>
      <a class="icon-btn" href="#/edit/${c.id}" aria-label="수정">${icon('edit')}</a>
    </div>
    <div class="detail-grid">
    <div class="col">
      <div class="profile">
        <div class="avatar">${esc(c.name.slice(0, 1))}</div>
        <div style="min-width:0;flex:1">
          <div class="nm">${esc(c.name)} ${gradeBadge(c.grade)}</div>
          <div class="ph">${esc(c.phone)}</div>
        </div>
        ${lead ? `<label class="owner-pick">담당<select id="owner"><option value="">미배정</option>${s.staff.map((x) => `<option value="${x.id}" ${c.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      </div>

      <div class="actions">
        <a class="btn" href="tel:${esc(c.phoneDigits)}">${icon('phone')}전화</a>
        <a class="btn" href="${esc(smsLink(c.phone))}">${icon('message')}문자</a>
        <button class="btn btn-soft" id="compose">${icon('send')}문자 생성</button>
        <button class="btn btn-primary" id="done">${icon('check')}관리 완료</button>
      </div>

      <div class="card">
        <div class="next-box">
          ${ddayBadge(c.nextDate)}
          <div>
            <div class="when">${c.nextDate ? `다음 관리 ${fmtDate(c.nextDate)}` : '다음 관리일 미지정'}</div>
            <div class="sub">${since === null ? '접촉 기록 없음' : since === 0 ? '오늘 접촉함' : `마지막 접촉 ${since}일 전`} · ${esc(c.grade)}등급 주기 ${cycle}일${n !== null && n < 0 ? ` · <b style="color:var(--danger)">${-n}일 지남</b>` : ''}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>${icon('clock', 'sm')} 견본주택 방문 예약</h3>
        ${c.visitDate ? `<div class="visit-box">
            <div><div class="when">${fmtDate(c.visitDate)} ${esc(c.visitTime || '')}</div>
              <div class="sub">${c.visitDone ? '<span class="ok-txt">✓ 방문 완료</span>' : vd === 0 ? '<span class="warn-txt">오늘 방문</span>' : vd > 0 ? `${vd}일 후` : '<span class="danger-txt">방문 여부 미확인</span>'}</div></div>
            ${c.visitDone ? '' : '<button class="btn btn-sm btn-primary" id="visit-done">방문 확인</button>'}
          </div>` : ''}
        <div class="two" style="margin-top:${c.visitDate ? '10px' : '0'}">
          <input type="date" id="v-date" class="input" value="${esc(c.visitDate || '')}" aria-label="방문일">
          <input type="time" id="v-time" class="input" step="600" value="${esc(c.visitTime || '')}" aria-label="방문 시간">
        </div>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn-sm" id="v-save">${c.visitDate ? '예약 변경' : '예약 저장'}</button>${c.visitDate ? '<button class="btn btn-sm" id="v-clear">예약 취소</button>' : ''}</div>
      </div>

      <div class="card">
        <h3>${icon('won', 'sm')} 계약 일정 <span class="cnt-sm">${sched.filter((x) => !x.done).length ? `남은 일정 ${sched.filter((x) => !x.done).length}` : ''}</span></h3>
        ${sched.length ? `<ul class="sched">${sched.map((it) => {
          const d = daysLeft(it.date);
          return `<li class="${it.done ? 'done' : d < 0 ? 'late' : ''}">
            <button class="chk ${it.done ? 'on' : ''}" data-tog="${it.id}" aria-label="${isPayKind(it.kind) ? '입금 확인' : '완료'}">${icon('check', 'sm')}</button>
            <div class="b" data-edit-s="${it.id}"><b>${esc(it.kind)}</b>${it.amount ? ` <span class="amt">${fmtMoney(it.amount)}</span>` : ''}
              <div class="sm">${it.date ? fmtShort(it.date) : '날짜 미정'}${it.done ? ` · ${isPayKind(it.kind) ? '입금 확인' : '완료'} ${it.doneDate ? fmtShort(it.doneDate) : ''}` : ''}${it.memo ? ` · ${esc(it.memo)}` : ''}</div></div>
            ${it.done ? '' : `<span class="dd-txt ${d < 0 ? 'over' : d === 0 ? 'today' : ''}">${ddayLabel(it.date)}</span>`}
          </li>`;
        }).join('')}</ul>` : `<p class="muted-p">${c.grade === '계약' ? '계약금·중도금·잔금 일정을 등록하면 팀장 대시보드에 표시됩니다.' : '계약이 진행되면 일정을 등록하세요.'}</p>`}
        <button class="btn btn-soft btn-block btn-sm" id="add-s">${icon('plus', 'sm')} 일정 추가</button>
      </div>

      ${showContract ? `<div class="card">
        <h3>${icon('file', 'sm')} 계약 서류 <span class="cnt-sm">${docs.length ? `${docs.filter((d) => d.done).length}/${docs.length}` : ''}</span></h3>
        ${docs.length ? `<div class="docs">${docs.map((d) => `<button class="doc ${d.done ? 'on' : ''}" data-doc="${esc(d.name)}">${d.done ? '✓ ' : ''}${esc(d.name)}</button>`).join('')}</div>
          <div class="two" style="margin-top:8px;grid-template-columns:1fr auto"><input class="input" id="doc-new" placeholder="서류 추가 (예: 혼인관계증명서)"><button class="btn btn-sm" id="doc-add">추가</button></div>
          <p class="muted-p" style="margin:6px 0 0">누르면 제출/미제출 전환 · 길게 누르면 삭제</p>`
        : `<button class="btn btn-block btn-sm" id="doc-init">${icon('file', 'sm')} 기본 서류 체크리스트 만들기</button>`}
      </div>` : ''}

      <div class="card">
        <dl class="info" style="margin:0">
          ${lead ? row('담당', esc(staffName(s, c.owner))) : ''}
          ${row('현장', esc(c.site))}
          ${row('관심 타입', esc(c.unitType))}
          ${row('동·호수', esc(c.unit))}
          ${row('유입경로', esc(c.source))}
          ${row('최초상담일', c.firstDate && fmtDate(c.firstDate))}
          ${row('최근접촉일', c.lastContact && fmtDate(c.lastContact))}
          ${row('태그', (c.tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`).join(''))}
        </dl>
        ${c.memo ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><div style="font-size:13px;color:var(--text-2);font-weight:700;margin-bottom:4px">관리 메모</div><div style="white-space:pre-wrap">${esc(c.memo)}</div></div>` : ''}
      </div>
    </div>

    <div class="col">
      <div class="card">
        <h3>접촉 기록 추가</h3>
        <div class="seg" id="kinds" style="margin-bottom:10px">${CONTACT_KINDS.map((k, i) => `<button type="button" data-k="${k}" class="${i === 0 ? 'on' : ''}">${k}</button>`).join('')}</div>
        <div class="field"><textarea id="h-text" placeholder="상담·통화 내용" style="min-height:80px"></textarea></div>
        <div class="two">
          <div class="field"><label>접촉일</label><input type="date" id="h-date" value="${t}" max="${t}"></div>
          <div class="field"><label>다음 관리일</label><input type="date" id="h-next" value="${addDays(t, cycle)}"></div>
        </div>
        <div class="hint" id="h-hint" style="font-size:13px;color:var(--text-2);margin:-6px 0 10px">${esc(c.grade)}등급 주기 ${cycle}일로 자동 계산됨</div>
        <button class="btn btn-primary btn-block" id="h-add">기록 저장</button>
      </div>

      <div class="card">
        <h3>상담 히스토리 <span style="color:var(--text-3);font-weight:600">${hist.length}</span></h3>
        ${hist.length ? `<ul class="hist">${hist.map((h) => `
          <li><span class="d">${esc(h.date.slice(2).replace(/-/g, '.'))}</span>
            <span class="t"><span class="k ${esc(h.kind.replace(/\s/g, ''))}">${esc(h.kind)}</span>${esc(h.text)}</span>
            <button class="rm" data-h="${h.id}" aria-label="기록 삭제">×</button></li>`).join('')}</ul>`
        : '<div style="color:var(--text-3);font-size:14px">아직 기록이 없습니다.</div>'}
      </div>
      ${canDelete ? `<button class="btn btn-block btn-danger" id="del" style="margin-top:4px">${icon('trash', 'sm')} 고객 삭제</button>`
        : '<p class="muted-p" style="text-align:center">팀장이 배정한 손님은 팀장만 삭제할 수 있습니다.</p>'}
    </div>
    </div>`;

  el.querySelector('#back').onclick = () => (history.length > 1 ? history.back() : go('#/customers'));
  el.querySelector('#done').onclick = () => doneSheet(c.id, ctx.rerender);
  el.querySelector('#compose').onclick = () => composeSheet(c, ctx.rerender);

  // 담당 변경 (팀장)
  const ow = el.querySelector('#owner');
  if (ow) ow.onchange = async () => {
    await patchCustomer(c.id, (x) => { x.owner = ow.value; });
    toast(`담당을 ${staffName(s, ow.value)}(으)로 바꿨습니다 · 배정 파일을 다시 보내주세요`); ctx.rerender();
  };

  // 방문 예약
  const vDone = el.querySelector('#visit-done');
  if (vDone) vDone.onclick = async () => {
    await patchCustomer(c.id, (x) => {
      x.visitDone = true; x.lastContact = t;
      x.history = [{ id: uid(), date: t, kind: '방문', text: '견본주택 방문' }, ...(x.history || [])];
    });
    toast('방문 확인했습니다'); ctx.rerender();
  };
  el.querySelector('#v-save').onclick = async () => {
    const d = el.querySelector('#v-date').value, tm = el.querySelector('#v-time').value;
    if (!d) { toast('방문일을 고르세요'); return; }
    await patchCustomer(c.id, (x) => {
      if (x.visitDate !== d) x.visitDone = false;
      x.visitDate = d; x.visitTime = tm;
      x.history = [{ id: uid(), date: t, kind: '상담', text: `방문 예약 ${fmtShort(d)} ${tm}` }, ...(x.history || [])];
    });
    toast(`방문 예약 ${fmtShort(d)} ${tm}`); ctx.rerender();
  };
  const vClear = el.querySelector('#v-clear');
  if (vClear) vClear.onclick = async () => {
    await patchCustomer(c.id, (x) => { x.visitDate = ''; x.visitTime = ''; x.visitDone = false; });
    toast('방문 예약을 취소했습니다'); ctx.rerender();
  };

  // 계약 일정
  el.querySelector('#add-s').onclick = () => scheduleSheet(c, null, ctx.rerender);
  el.querySelectorAll('[data-edit-s]').forEach((b) => { b.onclick = () => scheduleSheet(c, sched.find((x) => x.id === b.dataset.editS), ctx.rerender); });
  el.querySelectorAll('[data-tog]').forEach((b) => {
    b.onclick = async () => {
      const it = sched.find((x) => x.id === b.dataset.tog);
      await toggleSchedule(c.id, it.id);
      toast(it.done ? `${it.kind} 확인 취소` : `${it.kind} ${isPayKind(it.kind) ? '입금 확인' : '완료'}`); ctx.rerender();
    };
  });

  // 서류
  const di = el.querySelector('#doc-init');
  if (di) di.onclick = async () => { await initDocs(c.id); ctx.rerender(); };
  el.querySelectorAll('[data-doc]').forEach((b) => {
    let timer = null, long = false;
    b.addEventListener('pointerdown', () => { long = false; timer = setTimeout(async () => {
      long = true;
      if (await confirmSheet({ title: `'${b.dataset.doc}' 항목을 뺄까요?`, ok: '빼기' })) { await removeDoc(c.id, b.dataset.doc); ctx.rerender(); }
    }, 650); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    b.onclick = async () => { if (long) return; await toggleDoc(c.id, b.dataset.doc); ctx.rerender(); };
  });
  const da = el.querySelector('#doc-add');
  if (da) da.onclick = async () => {
    const v = el.querySelector('#doc-new').value.trim();
    if (v) { await addDoc(c.id, v); ctx.rerender(); }
  };

  // 접촉 기록
  let kind = CONTACT_KINDS[0];
  el.querySelectorAll('#kinds [data-k]').forEach((b) => {
    b.onclick = () => { kind = b.dataset.k; el.querySelectorAll('#kinds [data-k]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  const hDate = el.querySelector('#h-date'), hNext = el.querySelector('#h-next'), hHint = el.querySelector('#h-hint');
  let nextTouched = false;
  hDate.onchange = () => { if (!nextTouched && hDate.value) hNext.value = addDays(hDate.value, cycle); };
  hNext.onchange = () => { nextTouched = true; hHint.textContent = hNext.value ? `직접 지정: ${fmtShort(hNext.value)}` : '다음 관리일 변경 안 함'; };
  el.querySelector('#h-add').onclick = async () => {
    const text = el.querySelector('#h-text').value.trim();
    if (!text) { toast('내용을 입력하세요'); el.querySelector('#h-text').focus(); return; }
    await addHistory(c.id, { date: hDate.value || t, kind, text }, { next: hNext.value || 'keep' });
    toast(hNext.value ? `기록 저장 · 다음 관리 ${fmtShort(hNext.value)}` : '기록 저장');
    ctx.rerender();
  };

  el.querySelectorAll('[data-h]').forEach((b) => {
    b.onclick = async () => {
      if (await confirmSheet({ title: '이 기록을 삭제할까요?', ok: '삭제', danger: true })) { await removeHistory(c.id, b.dataset.h); ctx.rerender(); }
    };
  });

  const del = el.querySelector('#del');
  if (del) del.onclick = async () => {
    if (await confirmSheet({ title: `${c.name} 고객을 삭제할까요?`, message: '상담 히스토리까지 모두 지워지며 되돌릴 수 없습니다. 백업이 없다면 먼저 설정에서 내보내기를 해두세요.', ok: '삭제', danger: true })) {
      await deleteCustomer(c.id);
      toast('삭제했습니다');
      location.replace('#/customers');
    }
  };
}

/** 계약 일정 추가/수정 시트 */
function scheduleSheet(c, it, onChange) {
  const t = today();
  const cur = it || { kind: c.grade === '계약' ? '계약금 2차' : '계약서 작성', date: t, amount: '', memo: '' };
  const { el, close } = openSheet(`
    <h2>${it ? '일정 수정' : '계약 일정 추가'}</h2>
    <p class="sheet-sub">${esc(c.name)} ${c.unit ? `· ${esc(c.unit)}` : ''}</p>
    <div class="chips wrap" id="sk">${SCHEDULE_KINDS.map((k) => `<button class="chip ${k === cur.kind ? 'on' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="two">
      <div class="field"><label>날짜</label><input type="date" id="s-date" value="${esc(cur.date || '')}"></div>
      <div class="field"><label>금액 (만원)</label><input type="number" inputmode="numeric" id="s-amt" value="${esc(cur.amount || '')}" placeholder="2500"></div>
    </div>
    <div class="quick-dates" style="margin:-6px 0 12px">${[0, 7, 14, 30].map((d) => `<button data-d="${d}">${d ? `+${d}일` : '오늘'}</button>`).join('')}</div>
    <div class="field"><label>메모</label><input id="s-memo" value="${esc(cur.memo || '')}" placeholder="예: 가상계좌 입금 예정"></div>
    <button class="btn btn-primary btn-block" id="s-save">저장</button>
    ${it ? '<button class="btn btn-block btn-danger" id="s-del" style="margin-top:8px">일정 삭제</button>' : ''}`);
  let kind = cur.kind;
  el.querySelectorAll('#sk [data-k]').forEach((b) => { b.onclick = () => { kind = b.dataset.k; el.querySelectorAll('#sk [data-k]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  el.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { el.querySelector('#s-date').value = addDays(t, Number(b.dataset.d)); }; });
  el.querySelector('#s-save').onclick = async () => {
    const date = el.querySelector('#s-date').value;
    if (!date) { toast('날짜를 고르세요'); return; }
    await upsertSchedule(c.id, { ...(it || {}), kind, date, amount: Number(el.querySelector('#s-amt').value) || 0, memo: el.querySelector('#s-memo').value.trim() });
    close(); toast(`${kind} ${fmtShort(date)} 저장`); onChange();
  };
  const d = el.querySelector('#s-del');
  if (d) d.onclick = async () => { await removeSchedule(c.id, it.id); close(); toast('일정을 삭제했습니다'); onChange(); };
}
