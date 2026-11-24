// 고객 등록/수정
import { getSettings } from '../db.js';
import { getCustomer, saveCustomer, findDuplicate, listCustomers } from '../store.js';
import { esc, formatPhone, today, addDays, GRADES, SOURCES, fmtShort, uid } from '../utils.js';
import { icon, go, toast, confirmSheet, siteState, siteNames } from '../ui.js';

export async function render(el, ctx) {
  const editing = ctx.name === 'edit';
  const s = await getSettings();
  const all = await listCustomers();
  let c = editing ? await getCustomer(ctx.params[0]) : null;
  if (editing && !c) { go('#/customers'); return; }
  const t = today();
  const sites = await siteNames(all);
  const types = [...new Set(all.map((x) => x.unitType).filter(Boolean))];
  c = c || {
    name: '', phone: '', site: siteState.get() || sites[0] || '', unitType: '', unit: '',
    grade: 'B', source: '', firstDate: t, lastContact: t, nextDate: addDays(t, s.cycles.B), visitDate: '', visitTime: '',
    memo: '', tags: [], history: [], schedule: [], docs: [],
    owner: s.mode === 'staff' && s.me ? s.me.id : '',
  };
  const lead = s.mode === 'lead';
  let nextTouched = editing; // 수정 화면에선 등급 바꿔도 관리일 자동 변경 안 함

  const seg = (name, items, cur) => `<div class="seg" data-seg="${name}">${items.map((v) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>`;

  el.innerHTML = `
    <div class="page-head">
      <button class="icon-btn back" aria-label="뒤로" id="back">${icon('left')}</button>
      <h1>${editing ? '고객 수정' : '고객 등록'}</h1>
    </div>
    <form id="f" autocomplete="off" novalidate>
      <div class="card">
        <div class="field"><label>이름 <span class="req">*</span></label><input name="name" value="${esc(c.name)}" placeholder="홍길동" required></div>
        <div class="field"><label>연락처 <span class="req">*</span></label>
          <input name="phone" type="tel" inputmode="numeric" value="${esc(c.phone)}" placeholder="010-0000-0000">
          <div class="warn hidden" id="dup"></div></div>
        <div class="two">
          <div class="field"><label>현장명</label><input name="site" list="dl-site" value="${esc(c.site)}" placeholder="현장 선택"></div>
          <div class="field"><label>관심 타입/평형</label><input name="unitType" list="dl-type" value="${esc(c.unitType)}" placeholder="84A"></div>
        </div>
        <datalist id="dl-site">${sites.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <datalist id="dl-type">${types.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field"${lead ? '' : ' style="margin-bottom:0"'}><label>동·호수 (선택)</label><input name="unit" value="${esc(c.unit)}" placeholder="103동 1502호"></div>
        ${lead ? `<div class="field" style="margin-bottom:0"><label>담당 직원</label><select name="owner"><option value="">미배정</option>
          ${s.staff.map((x) => `<option value="${x.id}" ${c.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
      </div>

      <div class="card">
        <div class="field"><label>등급</label>${seg('grade', GRADES, c.grade)}</div>
        <div class="field" style="margin-bottom:0"><label>유입경로</label>${seg('source', SOURCES, c.source)}</div>
      </div>

      <div class="card">
        <div class="field"><label>다음 관리일</label>
          <input name="nextDate" type="date" value="${esc(c.nextDate || '')}">
          <div class="quick-dates" id="qd">
            <button type="button" data-g>등급 기본</button>
            <button type="button" data-n="1">+1일</button><button type="button" data-n="3">+3일</button><button type="button" data-n="7">+7일</button>
            <button type="button" data-n="14">+14일</button><button type="button" data-clear>지우기</button>
          </div>
          <div class="hint" id="next-hint"></div></div>
        <div class="two">
          <div class="field"><label>최초상담일</label><input name="firstDate" type="date" value="${esc(c.firstDate || '')}"></div>
          <div class="field"><label>최근접촉일</label><input name="lastContact" type="date" value="${esc(c.lastContact || '')}"></div>
        </div>
        <div class="two">
          <div class="field" style="margin-bottom:0"><label>견본주택 방문 예약일</label><input name="visitDate" type="date" value="${esc(c.visitDate || '')}"></div>
          <div class="field" style="margin-bottom:0"><label>방문 시간</label><input name="visitTime" type="time" step="600" value="${esc(c.visitTime || '')}"></div>
        </div>
        <div class="hint" style="font-size:13px;color:var(--text-3);margin-top:4px">팀장 대시보드 '오늘 방문 예약'과 문자 {방문일}에 쓰입니다.</div>
      </div>

      <div class="card">
        <div class="field"><label>태그</label><input name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="실거주, 대출문의 (쉼표로 구분)"></div>
        <div class="field"><label>관리 메모</label><textarea name="memo" placeholder="고객 특징, 선호 조건, 주의사항">${esc(c.memo)}</textarea></div>
        ${editing ? '' : `<div class="field" style="margin-bottom:0"><label>오늘 상담 내용 (히스토리에 기록)</label><textarea name="firstNote" placeholder="상담 내용을 적어두면 히스토리 첫 기록이 됩니다"></textarea></div>`}
      </div>

      <button class="btn btn-primary btn-block" type="submit" style="min-height:56px;font-size:17px">${icon('check')} 저장</button>
    </form>`;

  const f = el.querySelector('#f');
  const val = { grade: c.grade, source: c.source };
  el.querySelector('#back').onclick = () => history.length > 1 ? history.back() : go('#/customers');

  // 세그먼트 버튼
  el.querySelectorAll('[data-seg]').forEach((g) => {
    g.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const name = g.dataset.seg;
        val[name] = (val[name] === b.dataset.v && name === 'source') ? '' : b.dataset.v;
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === val[name]));
        if (name === 'grade' && !nextTouched) setNext(addDays(f.lastContact.value || t, s.cycles[val.grade] ?? 7), false);
        updateHint();
      };
    });
  });

  // 다음 관리일
  const setNext = (v, touched = true) => { f.nextDate.value = v; if (touched) nextTouched = true; updateHint(); };
  const updateHint = () => {
    const cyc = s.cycles[val.grade] ?? 7;
    el.querySelector('#next-hint').textContent = f.nextDate.value
      ? `${fmtShort(f.nextDate.value)} · ${val.grade}등급 기본주기 ${cyc}일`
      : '관리일 미지정 (홈 대시보드 맨 아래에 표시)';
    el.querySelector('[data-g]').textContent = `등급 기본 +${cyc}일`;
  };
  f.nextDate.addEventListener('change', () => { nextTouched = true; updateHint(); });
  el.querySelectorAll('#qd [data-n]').forEach((b) => { b.onclick = () => setNext(addDays(t, Number(b.dataset.n))); });
  el.querySelector('#qd [data-g]').onclick = () => setNext(addDays(f.lastContact.value || t, s.cycles[val.grade] ?? 7));
  el.querySelector('#qd [data-clear]').onclick = () => setNext('');
  updateHint();

  // 연락처: 하이픈 자동 + 중복 경고
  const dupEl = el.querySelector('#dup');
  let dupRec = null;
  const checkDup = async () => {
    dupRec = await findDuplicate(f.phone.value, c.id);
    if (dupRec) {
      dupEl.innerHTML = `이미 등록된 번호입니다: <a href="#/c/${dupRec.id}">${esc(dupRec.name)} (${esc(dupRec.site || '현장 미지정')})</a>`;
      dupEl.classList.remove('hidden');
    } else dupEl.classList.add('hidden');
  };
  f.phone.addEventListener('input', () => {
    const pos = f.phone.selectionStart, before = f.phone.value.length;
    f.phone.value = formatPhone(f.phone.value);
    const p = pos + (f.phone.value.length - before);
    try { f.phone.setSelectionRange(p, p); } catch (e) { /* 무시 */ }
    checkDup();
  });
  if (c.phone) checkDup();

  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) { toast('이름을 입력하세요'); f.name.focus(); return; }
    if (f.phone.value.replace(/\D/g, '').length < 9) { toast('연락처를 확인하세요'); f.phone.focus(); return; }
    await checkDup();
    if (dupRec && !(await confirmSheet({ title: '중복된 번호입니다', message: `${dupRec.name} 고객과 같은 번호입니다. 그래도 저장할까요?`, ok: '저장' }))) return;
    const rec = {
      ...c, name,
      phone: f.phone.value, site: f.site.value.trim(), unitType: f.unitType.value.trim(), unit: f.unit.value.trim(),
      grade: val.grade, source: val.source,
      firstDate: f.firstDate.value, lastContact: f.lastContact.value, nextDate: f.nextDate.value, visitDate: f.visitDate.value,
      visitTime: f.visitDate.value ? f.visitTime.value : '',
      visitDone: f.visitDate.value === c.visitDate ? !!c.visitDone : false,
      owner: lead ? f.owner.value : c.owner,
      tags: f.tags.value.split(/[,，#]/).map((x) => x.trim()).filter(Boolean),
      memo: f.memo.value.trim(),
    };
    if (!editing) {
      const note = f.firstNote.value.trim();
      rec.history = [{ id: uid(), date: rec.firstDate || t, kind: '상담', text: note || `최초 상담${rec.source ? ` (${rec.source})` : ''}` }];
    }
    const saved = await saveCustomer(rec);
    toast(editing ? '수정했습니다' : `${saved.name} 고객을 등록했습니다`);
    if (editing) history.back(); else location.replace(`#/c/${saved.id}`);
  };
}
