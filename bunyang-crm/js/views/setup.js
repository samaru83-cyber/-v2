// 첫 실행: 사용 방식 선택 (팀장 / 직원 / 혼자)
import { getSettings, saveSettings } from '../db.js';
import { esc, uid, formatPhone } from '../utils.js';
import { icon, toast } from '../ui.js';
import { readPackage, importAssign } from '../team.js';
import { buildNav } from '../app.js';

export async function render(el) {
  const s = await getSettings();
  el.innerHTML = `
    <div class="setup">
      <div style="text-align:center;margin:12px 0 24px">
        <img src="icons/icon-192.png" alt="" width="72" height="72" style="border-radius:18px">
        <h1 style="font-size:24px;margin:12px 0 4px">분양 고객관리</h1>
        <p style="color:var(--text-2);margin:0">어떻게 사용하실지 골라주세요${s.mode ? ' (나중에 설정에서 바꿀 수 있습니다)' : ''}</p>
      </div>
      <div class="setup-grid">
        <button class="setup-card" data-m="lead">${icon('team')}<b>팀장</b><span>PC에서 손님을 등록하고 직원에게 배정합니다. 직원별 방문·계약금·서류 현황을 한눈에 봅니다.</span></button>
        <button class="setup-card" data-m="staff">${icon('users')}<b>직원</b><span>팀장에게 받은 배정 파일로 시작합니다. 내 손님만 관리하고 보고 파일을 보냅니다.</span></button>
        <button class="setup-card" data-m="solo">${icon('home')}<b>혼자 사용</b><span>팀 없이 내 손님만 관리합니다.</span></button>
      </div>
      <div id="step"></div>
    </div>`;

  const step = el.querySelector('#step');
  el.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
      ({ lead: leadStep, staff: staffStep, solo: soloStep })[b.dataset.m](step, s);
      step.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function leadStep(step, s) {
  step.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3>팀장 정보</h3>
      <div class="two">
        <div class="field"><label>이름</label><input id="nm" value="${esc(s.agentName)}" placeholder="홍길동"></div>
        <div class="field"><label>연락처</label><input id="ph" type="tel" value="${esc(s.agentPhone)}" placeholder="010-0000-0000"></div>
      </div>
      <div class="field"><label>직원 이름 (한 줄에 한 명)</label><textarea id="staff" placeholder="김대리&#10;이주임&#10;박사원">${esc((s.staff || []).map((x) => x.name).join('\n'))}</textarea>
        <div class="hint">나중에 설정에서 추가·수정할 수 있습니다.</div></div>
      <button class="btn btn-primary btn-block" id="go">시작하기</button>
    </div>`;
  step.querySelector('#ph').addEventListener('input', (e) => { e.target.value = formatPhone(e.target.value); });
  step.querySelector('#go').onclick = async () => {
    const name = step.querySelector('#nm').value.trim();
    if (!name) { toast('이름을 입력하세요'); return; }
    const names = step.querySelector('#staff').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const staff = names.map((n) => (s.staff || []).find((x) => x.name === n) || { id: uid(), name: n, phone: '' });
    await saveSettings({ mode: 'lead', agentName: name, agentPhone: step.querySelector('#ph').value, staff });
    await buildNav(true);
    location.hash = '#/team';
  };
}

function staffStep(step, s) {
  step.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3>팀장에게 받은 배정 파일이 있나요?</h3>
      <p style="color:var(--text-2);font-size:14px;margin:0 0 12px">카톡으로 받은 <b>배정_이름_날짜.json</b> 파일을 저장한 뒤 불러오세요. 내 이름·현장·손님이 자동으로 들어옵니다.</p>
      <button class="btn btn-primary btn-block" id="pick">${icon('upload')} 배정 파일 불러오기</button>
      <input type="file" id="file" accept=".json,application/json" class="hidden">
      <div style="text-align:center;color:var(--text-3);font-size:13px;margin:14px 0 8px">또는</div>
      <div class="field"><label>내 이름으로 먼저 시작</label><input id="nm" value="${esc(s.agentName)}" placeholder="김대리"></div>
      <button class="btn btn-block" id="go">파일 없이 시작</button>
    </div>`;
  const fi = step.querySelector('#file');
  step.querySelector('#pick').onclick = () => fi.click();
  fi.onchange = async () => {
    const f = fi.files[0]; fi.value = '';
    if (!f) return;
    try {
      const pkg = await readPackage(f);
      if (pkg.type !== 'assign') { toast('배정 파일이 아닙니다'); return; }
      const r = await importAssign(pkg);
      toast(`${pkg.staff.name}님, 손님 ${r.added + r.updated}명을 받았습니다`);
      await buildNav(true);
      location.hash = '#/home';
    } catch (e) { toast(e.message); }
  };
  step.querySelector('#go').onclick = async () => {
    const name = step.querySelector('#nm').value.trim();
    if (!name) { toast('이름을 입력하세요'); return; }
    await saveSettings({ mode: 'staff', me: { id: uid(), name }, agentName: name });
    await buildNav(true);
    location.hash = '#/home';
  };
}

async function soloStep() {
  await saveSettings({ mode: 'solo' });
  await buildNav(true);
  location.hash = '#/home';
}
