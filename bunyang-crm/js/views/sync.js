// 파일 주고받기: (팀장) 배정 파일 보내기 · 보고 파일 받기 · 엑셀 가져오기 / (직원) 보고 보내기 · 배정 받기
import { getSettings } from '../db.js';
import { listCustomers } from '../store.js';
import { esc, relTime, today } from '../utils.js';
import { icon, toast, confirmSheet } from '../ui.js';
import { readPackage, importAssign, importReport, sendAssignFile, sendReportFile, previewCSV, commitCSV } from '../team.js';
import { buildNav } from '../app.js';

export async function render(el, ctx) {
  const s = await getSettings();
  if (s.mode === 'lead') return renderLead(el, ctx, s);
  if (s.mode === 'staff') return renderStaff(el, ctx, s);
  location.replace('#/settings');
}

// ---------------- 팀장 ----------------
async function renderLead(el, ctx, s) {
  const all = await listCustomers();
  const cnt = (id) => all.filter((c) => c.owner === id).length;
  const t = today();
  el.innerHTML = `
    <div class="page-head"><h1>파일 주고받기</h1></div>
    <div class="flow">
      <div><b>1</b>팀장이 손님 등록·배정</div><span>→</span>
      <div><b>2</b>직원별 <u>배정 파일</u>을 카톡으로 전송</div><span>→</span>
      <div><b>3</b>직원이 관리 후 <u>보고 파일</u> 전송</div><span>→</span>
      <div><b>4</b>팀장 PC에 끌어다 놓으면 합쳐짐</div>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <div class="panel-head">${icon('download', 'sm')} 직원에게 배정 파일 보내기</div>
        ${s.staff.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>직원</th><th>담당 손님</th><th>마지막 배정 파일</th><th></th></tr></thead><tbody>
          ${s.staff.map((st) => {
            const sy = s.staffSync[st.id] || {};
            return `<tr><td><b>${esc(st.name)}</b></td><td class="num">${cnt(st.id)}명</td><td class="sm">${sy.assignAt ? relTime(sy.assignAt) : '보낸 적 없음'}</td>
              <td><button class="btn btn-sm btn-primary" data-assign="${st.id}">파일 만들기</button></td></tr>`;
          }).join('')}</tbody></table></div>
          <button class="btn btn-block" id="assign-all" style="margin-top:10px">${icon('download', 'sm')} 모든 직원 파일 한번에 만들기</button>
          <p class="panel-note">만든 파일(배정_이름_날짜.json)을 카톡 PC버전으로 직원에게 보내세요. 직원이 불러오면 그 직원 손님만 들어갑니다. 재배정한 손님은 이전 직원 휴대폰에서 자동으로 빠집니다.</p>`
        : '<div class="panel-empty">설정에서 직원을 먼저 등록하세요</div>'}
      </section>

      <section class="panel">
        <div class="panel-head">${icon('upload', 'sm')} 직원 보고 파일 받기</div>
        <label class="drop" id="drop">
          ${icon('upload')}<b>보고 파일을 여기에 끌어다 놓기</b><span>여러 개를 한꺼번에 놓아도 됩니다 · 클릭해서 선택</span>
          <input type="file" id="rep" accept=".json,application/json" multiple class="hidden">
        </label>
        <div id="rep-result"></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>직원</th><th>최근 보고</th><th>받은 손님</th></tr></thead><tbody>
          ${s.staff.map((st) => {
            const sy = s.staffSync[st.id] || {};
            const ok = sy.reportAt && sy.reportAt.slice(0, 10) === t;
            return `<tr><td>${esc(st.name)}</td><td><span class="${ok ? 'ok-txt' : 'danger-txt'}">${sy.reportAt ? relTime(sy.reportAt) : '받은 적 없음'}</span></td><td class="num">${sy.count ?? '-'}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="panel-note">같은 손님은 더 최근에 수정된 내용이 남고, 상담 히스토리는 합쳐집니다. 팀장이 한 입금 확인·재배정은 유지됩니다.</p>
      </section>

      <section class="panel wide">
        <div class="panel-head">${icon('file', 'sm')} 엑셀(CSV) 명단 가져오기</div>
        <p class="panel-note" style="margin-top:0">엑셀에서 <b>다른 이름으로 저장 → CSV</b>로 저장한 파일을 고르세요. 첫 줄 제목에 <b>이름, 연락처</b>가 꼭 있어야 하고,
          현장 · 관심타입 · 동호수 · 등급 · 유입경로 · 최초상담일 · 다음관리일 · 방문일 · 방문시간 · 메모 · <b>담당</b>(직원 이름) 열이 있으면 함께 들어갑니다.</p>
        <button class="btn" id="csv-pick">${icon('upload', 'sm')} CSV 파일 선택</button>
        <input type="file" id="csv" accept=".csv,text/csv,.txt" class="hidden">
        <div id="csv-preview"></div>
      </section>
    </div>`;

  // 배정 파일
  el.querySelectorAll('[data-assign]').forEach((b) => {
    b.onclick = async () => { const n = await sendAssignFile(b.dataset.assign); toast(`배정 파일 생성 · 손님 ${n}명`); ctx.rerender(); };
  });
  const aa = el.querySelector('#assign-all');
  if (aa) aa.onclick = async () => {
    for (const st of s.staff) { await sendAssignFile(st.id); await new Promise((r) => setTimeout(r, 400)); }
    toast(`직원 ${s.staff.length}명 배정 파일을 만들었습니다`); ctx.rerender();
  };

  // 보고 파일 (드래그 앤 드롭 + 선택)
  const drop = el.querySelector('#drop');
  const rep = el.querySelector('#rep');
  const handle = async (files) => {
    const out = [];
    for (const f of files) {
      try {
        const pkg = await readPackage(f);
        if (pkg.type === 'assign') { out.push(`<li class="danger-txt">${esc(f.name)}: 배정 파일입니다 (직원이 받는 파일)</li>`); continue; }
        if (pkg.type !== 'report') { out.push(`<li class="danger-txt">${esc(f.name)}: 보고 파일이 아닙니다. 전체 백업은 설정 → 백업에서 불러오세요</li>`); continue; }
        const r = await importReport(pkg);
        out.push(`<li class="ok-txt">✓ ${esc(r.staff)} · 새 손님 ${r.added}명, 갱신 ${r.updated}명${pkg.calls?.length ? `, 콜 ${pkg.calls.length}건` : ""} (${relTime(pkg.exportedAt)} 보고)</li>`);
      } catch (e) { out.push(`<li class="danger-txt">${esc(e.message)}</li>`); }
    }
    sessionStorage.setItem('repResult', out.join(''));
    await buildNav(true);
    ctx.rerender();
  };
  const last = sessionStorage.getItem('repResult');
  if (last) { el.querySelector('#rep-result').innerHTML = `<ul class="result">${last}</ul>`; sessionStorage.removeItem('repResult'); }
  rep.onchange = () => { const fs = [...rep.files]; rep.value = ''; if (fs.length) handle(fs); };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const fs = [...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name)); if (fs.length) handle(fs); });

  // CSV
  const csv = el.querySelector('#csv');
  el.querySelector('#csv-pick').onclick = () => csv.click();
  csv.onchange = async () => {
    const f = csv.files[0]; csv.value = '';
    if (!f) return;
    const box = el.querySelector('#csv-preview');
    try {
      const { rows } = await previewCSV(f);
      const dup = rows.filter((r) => r.dup).length;
      box.innerHTML = `
        <div style="margin:12px 0 8px;font-weight:700">${rows.length}명 읽음${dup ? ` · <span class="warn-txt">이미 있는 번호 ${dup}명</span>` : ''}</div>
        <div class="tbl-wrap" style="max-height:320px;overflow:auto"><table class="tbl"><thead><tr><th>이름</th><th>연락처</th><th>현장</th><th>타입</th><th>등급</th><th>담당</th><th></th></tr></thead><tbody>
          ${rows.slice(0, 200).map((r) => `<tr class="${r.dup ? 'muted' : ''}"><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.site)}</td><td>${esc(r.unitType)}</td><td>${esc(r.grade)}</td>
            <td>${r.owner ? esc(r.ownerName) : r.ownerName ? `<span class="warn-txt">${esc(r.ownerName)}?</span>` : '-'}</td><td>${r.dup ? '<span class="warn-txt">중복</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="csv-opts">
          <label>담당 열이 비어 있는 손님 →
            <select id="csv-owner"><option value="">미배정</option>${s.staff.map((st) => `<option value="${st.id}">${esc(st.name)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="csv-skip" checked> 이미 있는 번호는 건너뛰기</label>
          <button class="btn btn-primary" id="csv-go">가져오기</button>
        </div>
        ${rows.some((r) => r.ownerName && !r.owner) ? '<p class="panel-note warn-txt">물음표(?) 표시된 담당자는 직원 목록에 없는 이름이라 미배정(또는 위에서 고른 직원)으로 들어갑니다.</p>' : ''}`;
      box.querySelector('#csv-go').onclick = async () => {
        const n = await commitCSV(rows, { skipDup: box.querySelector('#csv-skip').checked, owner: box.querySelector('#csv-owner').value });
        toast(`손님 ${n}명을 가져왔습니다`);
        box.innerHTML = `<p class="ok-txt" style="font-weight:700">✓ ${n}명을 가져왔습니다. 고객 화면에서 확인하고, 배정 파일을 직원에게 보내세요.</p>`;
      };
    } catch (e) { box.innerHTML = `<p class="danger-txt">${esc(e.message)}</p>`; }
  };
}

// ---------------- 직원 ----------------
async function renderStaff(el, ctx, s) {
  const mine = (await listCustomers()).filter((c) => !c.owner || c.owner === s.me?.id);
  const reportedToday = s.lastReportAt && s.lastReportAt.slice(0, 10) === today();
  el.innerHTML = `
    <div class="page-head"><button class="icon-btn back" id="back" aria-label="뒤로">${icon('left')}</button><h1>팀장 보고</h1></div>
    <div class="card">
      <h3>팀장에게 보고 파일 보내기</h3>
      <p style="color:var(--text-2);font-size:14px;margin:0 0 12px">내 손님 ${mine.length}명의 상담 기록·일정이 담긴 파일을 만듭니다. 공유 화면에서 <b>카카오톡 → 팀장님</b>을 고르세요.</p>
      <button class="btn btn-primary btn-block" id="report" style="min-height:56px">${icon('send')} 보고 파일 보내기</button>
      <div style="font-size:13px;margin-top:8px;color:${reportedToday ? 'var(--ok)' : 'var(--warn)'}">${s.lastReportAt ? `마지막 보고: ${relTime(s.lastReportAt)}` : '아직 보고한 적이 없습니다'}</div>
    </div>
    <div class="card">
      <h3>팀장 배정 파일 불러오기</h3>
      <p style="color:var(--text-2);font-size:14px;margin:0 0 12px">카톡으로 받은 <b>배정_${esc(s.me?.name || '이름')}_날짜.json</b> 파일을 저장한 뒤 불러오세요. 새로 배정된 손님이 추가되고, 다른 직원에게 넘어간 손님은 빠집니다.</p>
      <button class="btn btn-block" id="pick">${icon('upload')} 배정 파일 불러오기</button>
      <input type="file" id="file" accept=".json,application/json" class="hidden">
      <div style="font-size:13px;margin-top:8px;color:var(--text-2)">${s.lastAssignAt ? `마지막으로 받은 시각: ${relTime(s.lastAssignAt)}` : ''}</div>
    </div>
    <p class="panel-note">💡 순서: 팀장 파일을 받기 전에 먼저 보고 파일을 보내 두면, 내가 수정한 내용이 사라질 일이 없습니다.</p>`;

  el.querySelector('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/home'));
  el.querySelector('#report').onclick = async () => {
    try { const n = await sendReportFile(); toast(`보고 파일을 만들었습니다 (손님 ${n}명)`); ctx.rerender(); } catch (e) { toast(e.message); }
  };
  const fi = el.querySelector('#file');
  el.querySelector('#pick').onclick = () => fi.click();
  fi.onchange = async () => {
    const f = fi.files[0]; fi.value = '';
    if (!f) return;
    try {
      const pkg = await readPackage(f);
      if (pkg.type !== 'assign') { toast('배정 파일이 아닙니다'); return; }
      if (s.me && pkg.staff.id !== s.me.id
        && !(await confirmSheet({ title: `${pkg.staff.name}님 파일입니다`, message: `지금 이 기기는 ${s.me.name}님으로 설정되어 있습니다. ${pkg.staff.name}님 기기로 바꿀까요?`, ok: '바꾸기', danger: true }))) return;
      const r = await importAssign(pkg);
      toast(`새 손님 ${r.added}명 · 갱신 ${r.updated}명${r.removed ? ` · 재배정으로 ${r.removed}명 빠짐` : ""}${r.calls ? ` · 콜 ${r.calls}건` : ""}`);
      await buildNav(true);
      ctx.rerender();
    } catch (e) { toast(e.message); }
  };
}
