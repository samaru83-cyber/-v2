// 설정: 상담사 정보, 현장·견본주택 주소, 관리주기, 테마, 백업/복원, 설치 안내
import { db, getSettings, saveSettings } from '../db.js';
import { listCustomers, listTemplates } from '../store.js';
import { esc, formatPhone, GRADES, today, fmtDate, isIOS, debounce, digitsOnly, uid } from '../utils.js';
import { icon, toast, confirmSheet, openSheet } from '../ui.js';
import { loadSampleData, removeSampleData } from '../seed.js';
import { applyTheme } from '../app.js';
import { listCalls } from '../calls.js';

export async function render(el, ctx) {
  const s = await getSettings();
  const customers = await listCustomers();
  const sampleCount = customers.filter((c) => c.sample).length;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const backupAge = s.lastBackup ? Math.floor((Date.now() - new Date(s.lastBackup)) / 86400000) : null;

  el.innerHTML = `
    <div class="page-head"><h1>설정</h1></div>
    <div class="privacy">${icon('shield')}<div>고객 정보는 이 휴대폰 안에만 저장되며 외부 서버로 전송되지 않습니다. 휴대폰을 바꾸거나 앱을 지우기 전에 꼭 백업하세요.</div></div>

    <div class="card">
      <h3>사용 방식</h3>
      <div class="set-row"><div class="lbl">${{ lead: '팀장 모드', staff: '직원 모드', solo: '혼자 사용' }[s.mode] || '미설정'}
        <small>${s.mode === 'lead' ? `직원 ${s.staff.length}명 · 손님 ${customers.length}명` : s.mode === 'staff' ? `${esc(s.me?.name || '')}${s.leadName ? ` · 팀장 ${esc(s.leadName)}` : ''}` : '팀 기능 없이 사용'}</small></div>
        ${s.mode !== 'solo' ? `<a class="btn btn-sm btn-soft" href="#/sync">${s.mode === 'lead' ? '파일 주고받기' : '팀장 보고'}</a>` : ''}
        <a class="btn btn-sm" href="#/setup">변경</a></div>
    </div>

    ${s.mode === 'lead' ? `<div class="card">
      <h3>직원 관리</h3>
      <div id="staff"></div>
      <div class="two" style="grid-template-columns:1fr 1fr auto;margin-top:8px">
        <input class="input" id="st-name" placeholder="직원 이름"><input class="input" id="st-phone" type="tel" placeholder="연락처 (선택)">
        <button class="btn btn-sm btn-primary" id="st-add">추가</button></div>
    </div>` : ''}

    <div class="card">
      <h3>${s.mode === 'staff' ? '내 정보' : s.mode === 'lead' ? '팀장 정보' : '상담사 정보'} <span style="font-weight:500;font-size:13px;color:var(--text-2)">문자 변수에 자동 반영</span></h3>
      <div class="field"><label>이름 {상담사명}</label><input id="agentName" value="${esc(s.agentName)}" placeholder="홍길동"></div>
      <div class="field"><label>연락처 {상담사연락처}</label><input id="agentPhone" type="tel" inputmode="numeric" value="${esc(s.agentPhone)}" placeholder="010-0000-0000"></div>
      <div class="field" style="margin-bottom:0"><label>기본 견본주택 주소 {견본주택주소}</label><input id="defaultAddress" value="${esc(s.defaultAddress)}" placeholder="현장별 주소가 없을 때 사용">
        <div class="hint">현장별 주소를 아래에 입력하면 고객의 현장에 맞는 주소가 들어갑니다.</div></div>
    </div>

    <div class="card">
      <h3>소속 현장 · 견본주택 주소</h3>
      <div id="sites"></div>
      <button class="btn btn-soft btn-block btn-sm" id="add-site" style="margin-top:8px">${icon('plus', 'sm')} 현장 추가</button>
    </div>

    <div class="card">
      <h3>등급별 기본 관리주기 (일)</h3>
      <div class="cycle-grid">${GRADES.map((g) => `<label>${g}<input type="number" inputmode="numeric" min="1" max="365" data-cycle="${g}" value="${s.cycles[g]}"></label>`).join('')}</div>
      <div class="hint" style="font-size:13px;color:var(--text-3);margin-top:8px">접촉을 기록하거나 관리 완료할 때 이 주기로 다음 관리일을 계산합니다.</div>
    </div>

    ${s.mode !== 'staff' ? `<div class="card">
      <h3>콜 종류</h3>
      <div class="chips wrap" id="ck-list">${(s.callKinds || []).map((k, i) => `<span class="chip ck">${esc(k)}<button class="ck-x" data-ck="${i}" aria-label="${esc(k)} 삭제">×</button></span>`).join('')}</div>
      <div class="two" style="grid-template-columns:1fr auto;margin-top:6px"><input class="input" id="ck-new" placeholder="예: 분양대행콜, 블로그콜"><button class="btn btn-sm" id="ck-add">${icon('plus', 'sm')} 추가</button></div>
      <div class="hint" style="font-size:13px;color:var(--text-3);margin-top:8px">콜 입력 화면의 종류 버튼입니다. 지워도 이미 입력한 콜 기록은 그대로 남습니다.</div>
    </div>` : ''}

    <div class="card">
      <h3>화면</h3>
      <div class="seg" id="theme">${[['system', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button data-v="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>

    <div class="card">
      <h3>백업 · 복원</h3>
      <div style="font-size:14px;margin-bottom:10px;color:${backupAge === null || backupAge > 7 ? 'var(--warn)' : 'var(--text-2)'}">
        ${s.lastBackup ? `마지막 백업: ${fmtDate(s.lastBackup.slice(0, 10))}${backupAge > 7 ? ` (${backupAge}일 전, 백업 권장)` : ''}` : '아직 백업한 적이 없습니다'}</div>
      <div style="display:grid;gap:8px">
        <button class="btn btn-primary" id="exp-json">${icon('download')} 전체 백업 (JSON 내보내기)</button>
        <button class="btn" id="imp-json">${icon('upload')} 백업 파일 불러오기</button>
        <button class="btn" id="exp-csv">${icon('download')} 엑셀용 내보내기 (CSV)</button>
      </div>
      <input type="file" id="file" accept=".json,application/json" class="hidden">
    </div>

    <div class="card">
      <h3>앱 설치</h3>
      <div id="install"></div>
    </div>

    <div class="card">
      <h3>테스트 · 초기화</h3>
      <div class="set-row"><div class="lbl">샘플 고객 10명<small>${sampleCount ? `현재 ${sampleCount}명 들어 있음` : '기능을 미리 써볼 수 있는 가상 고객'}</small></div>
        ${sampleCount ? '<button class="btn btn-sm" id="sample-del">지우기</button>' : '<button class="btn btn-sm btn-soft" id="sample-add">넣기</button>'}</div>
      <div class="set-row"><div class="lbl">모든 데이터 삭제<small>고객·템플릿·설정 전부</small></div><button class="btn btn-sm btn-danger" id="wipe">삭제</button></div>
    </div>
    <p class="ver">분양 고객관리 v1.0 · 고객 ${customers.length}명</p>`;

  // ---- 상담사 정보 자동 저장 ----
  const saveProfile = debounce(async () => {
    await saveSettings({
      agentName: el.querySelector('#agentName').value.trim(),
      agentPhone: el.querySelector('#agentPhone').value.trim(),
      defaultAddress: el.querySelector('#defaultAddress').value.trim(),
    });
    toast('저장됨');
  }, 600);
  ['agentName', 'defaultAddress'].forEach((id) => el.querySelector('#' + id).addEventListener('input', saveProfile));
  el.querySelector('#agentPhone').addEventListener('input', (e) => { e.target.value = formatPhone(e.target.value); saveProfile(); });

  // ---- 직원 관리 (팀장) ----
  const staffEl = el.querySelector('#staff');
  if (staffEl) {
    const cnt = (id) => customers.filter((c) => c.owner === id).length;
    staffEl.innerHTML = s.staff.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>연락처</th><th>담당 손님</th><th></th></tr></thead><tbody>
      ${s.staff.map((x) => `<tr><td><input class="input sm-in" data-sid="${x.id}" data-f="name" value="${esc(x.name)}"></td>
        <td><input class="input sm-in" data-sid="${x.id}" data-f="phone" value="${esc(x.phone || '')}" placeholder="-"></td>
        <td class="num">${cnt(x.id)}명</td><td><button class="icon-btn" data-srm="${x.id}" aria-label="직원 삭제">${icon('trash', 'sm')}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div style="color:var(--text-3);font-size:14px">등록된 직원이 없습니다.</div>';
    const saveStaff = debounce(async () => { await saveSettings({ staff: s.staff }); toast('저장됨'); }, 600);
    staffEl.querySelectorAll('[data-sid]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const x = s.staff.find((y) => y.id === inp.dataset.sid);
        x[inp.dataset.f] = inp.dataset.f === 'phone' ? (inp.value = formatPhone(inp.value)) : inp.value;
        saveStaff();
      });
    });
    staffEl.querySelectorAll('[data-srm]').forEach((b) => {
      b.onclick = async () => {
        const x = s.staff.find((y) => y.id === b.dataset.srm);
        const n = cnt(x.id);
        if (!(await confirmSheet({ title: `${x.name} 직원을 삭제할까요?`, message: n ? `담당 손님 ${n}명은 미배정으로 바뀝니다. 다른 직원에게 다시 배정하세요.` : '', ok: '삭제', danger: true }))) return;
        const now = new Date().toISOString();
        const recs = customers.filter((c) => c.owner === x.id).map((c) => ({ ...c, owner: '', updatedAt: now }));
        if (recs.length) await db.putMany('customers', recs);
        const cl = (await listCalls()).filter((c) => c.owner === x.id).map((c) => ({ ...c, owner: '', updatedAt: now }));
        if (cl.length) await db.putMany('calls', cl);
        await saveSettings({ staff: s.staff.filter((y) => y.id !== x.id) });
        toast('삭제했습니다'); ctx.rerender();
      };
    });
    el.querySelector('#st-phone').addEventListener('input', (e) => { e.target.value = formatPhone(e.target.value); });
    el.querySelector('#st-add').onclick = async () => {
      const name = el.querySelector('#st-name').value.trim();
      if (!name) { toast('직원 이름을 입력하세요'); return; }
      if (s.staff.some((y) => y.name === name)) { toast('같은 이름의 직원이 있습니다'); return; }
      await saveSettings({ staff: [...s.staff, { id: uid(), name, phone: el.querySelector('#st-phone').value }] });
      toast(`${name} 직원을 추가했습니다`); ctx.rerender();
    };
  }

  // ---- 현장 목록 ----
  let sites = (s.sites || []).map((x) => ({ ...x }));
  const sitesEl = el.querySelector('#sites');
  const saveSites = debounce(async () => { await saveSettings({ sites: sites.filter((x) => x.name.trim()) }); toast('저장됨'); }, 600);
  const drawSites = () => {
    sitesEl.innerHTML = sites.length ? sites.map((x, i) => `
      <div class="site-item">
        <input data-i="${i}" data-f="name" value="${esc(x.name)}" placeholder="현장명">
        <button class="icon-btn" data-rm="${i}" aria-label="현장 삭제">${icon('trash', 'sm')}</button>
        <input class="addr" data-i="${i}" data-f="address" value="${esc(x.address || '')}" placeholder="견본주택 주소">
      </div>`).join('') : '<div style="color:var(--text-3);font-size:14px">등록된 현장이 없습니다. 현장을 2개 이상 등록하면 화면 위에 현장 탭이 생깁니다.</div>';
    sitesEl.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => { sites[inp.dataset.i][inp.dataset.f] = inp.value; saveSites(); });
    });
    sitesEl.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const x = sites[b.dataset.rm];
        const used = customers.filter((c) => c.site === x.name).length;
        if (used && !(await confirmSheet({ title: `'${x.name}' 현장을 목록에서 뺄까요?`, message: `이 현장 고객 ${used}명의 정보는 그대로 유지됩니다.`, ok: '빼기' }))) return;
        sites.splice(b.dataset.rm, 1); drawSites(); saveSites();
      };
    });
  };
  drawSites();
  el.querySelector('#add-site').onclick = () => { sites.push({ name: '', address: '' }); drawSites(); sitesEl.querySelector(`[data-i="${sites.length - 1}"]`).focus(); };

  // ---- 관리주기 ----
  el.querySelectorAll('[data-cycle]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const v = Math.max(1, Math.min(365, parseInt(inp.value, 10) || 1));
      inp.value = v;
      const cur = await getSettings();
      await saveSettings({ cycles: { ...cur.cycles, [inp.dataset.cycle]: v } });
      toast(`${inp.dataset.cycle}등급 주기 ${v}일로 저장`);
    });
  });

  // ---- 콜 종류 ----
  el.querySelectorAll('[data-ck]').forEach((b) => {
    b.onclick = async () => {
      const kinds = [...s.callKinds];
      kinds.splice(Number(b.dataset.ck), 1);
      await saveSettings({ callKinds: kinds });
      toast('콜 종류를 지웠습니다'); ctx.rerender();
    };
  });
  const ckAdd = async () => {
    const inp = el.querySelector('#ck-new');
    const v = inp.value.trim();
    if (!v) return;
    if (s.callKinds.includes(v)) { toast('이미 있는 종류입니다'); return; }
    await saveSettings({ callKinds: [...s.callKinds, v] });
    toast(`'${v}' 추가`); ctx.rerender();
  };
  el.querySelector('#ck-add')?.addEventListener('click', ckAdd);
  el.querySelector('#ck-new')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') ckAdd(); });

  // ---- 테마 ----
  el.querySelectorAll('#theme button').forEach((b) => {
    b.onclick = async () => {
      await saveSettings({ theme: b.dataset.v });
      applyTheme(b.dataset.v);
      el.querySelectorAll('#theme button').forEach((x) => x.classList.toggle('on', x === b));
    };
  });

  // ---- 백업 ----
  el.querySelector('#exp-json').onclick = async () => {
    const data = { app: 'bunyang-crm', version: 1, exportedAt: new Date().toISOString(), customers: await listCustomers(), templates: await listTemplates(), calls: await listCalls(), settings: await getSettings() };
    await saveFile(`고객관리_백업_${today().replace(/-/g, '')}.json`, JSON.stringify(data, null, 1), 'application/json');
    await saveSettings({ lastBackup: new Date().toISOString() });
    toast(`고객 ${data.customers.length}명 백업 파일을 만들었습니다`);
    ctx.rerender();
  };
  el.querySelector('#exp-csv').onclick = async () => {
    const list = (await listCustomers()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    await saveFile(`고객목록_${today().replace(/-/g, '')}.csv`, '﻿' + toCSV(list), 'text/csv');
    toast(`고객 ${list.length}명을 CSV로 내보냈습니다`);
  };
  const fileInput = el.querySelector('#file');
  el.querySelector('#imp-json').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { toast('백업 파일을 읽을 수 없습니다'); return; }
    if (data.app !== 'bunyang-crm' || !Array.isArray(data.customers)) { toast('이 앱의 백업 파일이 아닙니다'); return; }
    if (data.type === 'assign' || data.type === 'report') { toast(`${data.type === 'assign' ? '배정' : '보고'} 파일입니다. 파일 주고받기 화면에서 불러오세요`); return; }
    importSheet(data, ctx);
  };

  // ---- 설치 안내 ----
  const inst = el.querySelector('#install');
  if (standalone) inst.innerHTML = '<div style="color:var(--ok);font-weight:600">✓ 홈 화면 앱으로 실행 중입니다</div>';
  else if (window.__installPrompt) {
    inst.innerHTML = `<button class="btn btn-primary btn-block" id="do-install">${icon('download')} 홈 화면에 설치</button>`;
    inst.querySelector('#do-install').onclick = async () => {
      window.__installPrompt.prompt();
      await window.__installPrompt.userChoice;
      window.__installPrompt = null; ctx.rerender();
    };
  } else if (isIOS()) {
    inst.innerHTML = '<ol style="margin:0;padding-left:20px;line-height:1.8;font-size:14px"><li>Safari 아래쪽 <b>공유 버튼(□↑)</b>을 누르세요</li><li><b>홈 화면에 추가</b>를 고르세요</li><li>오른쪽 위 <b>추가</b>를 누르면 끝</li></ol>';
  } else {
    inst.innerHTML = '<div style="font-size:14px;line-height:1.7">Chrome 오른쪽 위 <b>⋮ 메뉴 → 홈 화면에 추가</b>(또는 <b>앱 설치</b>)를 누르세요.</div>';
  }

  // ---- 샘플·초기화 ----
  const sa = el.querySelector('#sample-add');
  if (sa) sa.onclick = async () => { await loadSampleData(); toast('샘플 고객 10명을 넣었습니다'); ctx.rerender(); };
  const sd = el.querySelector('#sample-del');
  if (sd) sd.onclick = async () => {
    if (await confirmSheet({ title: '샘플 고객을 지울까요?', message: '직접 등록한 고객은 그대로 남습니다.', ok: '지우기' })) { await removeSampleData(); toast('샘플 고객을 지웠습니다'); ctx.rerender(); }
  };
  el.querySelector('#wipe').onclick = async () => {
    if (!(await confirmSheet({ title: '모든 데이터를 삭제할까요?', message: `고객 ${customers.length}명, 템플릿, 설정이 모두 지워지며 되돌릴 수 없습니다. 먼저 백업하세요.`, ok: '모두 삭제', danger: true }))) return;
    if (!(await confirmSheet({ title: '정말 삭제합니다', message: '마지막 확인입니다.', ok: '삭제', danger: true }))) return;
    await Promise.all(['customers', 'templates', 'settings', 'calls'].map((x) => db.clear(x)));
    location.hash = '#/home'; location.reload();
  };
}

function importSheet(data, ctx) {
  const n = data.customers.length, tn = (data.templates || []).length;
  const { el, close } = openSheet(`
    <h2>백업 불러오기</h2>
    <p class="sheet-sub">${data.exportedAt ? fmtDate(data.exportedAt.slice(0, 10)) + ' 백업 · ' : ''}고객 ${n}명, 템플릿 ${tn}개</p>
    <div style="display:grid;gap:8px">
      <button class="btn btn-primary" data-m="merge" style="flex-direction:column;gap:0;min-height:60px">합치기<small style="font-weight:500;opacity:.85">지금 데이터는 두고, 백업 내용을 추가·갱신</small></button>
      <button class="btn" data-m="replace" style="flex-direction:column;gap:0;min-height:60px;color:var(--danger)">전부 바꾸기<small style="font-weight:500;opacity:.85">지금 데이터를 지우고 백업으로 교체</small></button>
      <button class="btn" data-m="cancel">취소</button>
    </div>`);
  el.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = async () => {
      const m = b.dataset.m;
      close();
      if (m === 'cancel') return;
      if (m === 'replace') {
        if (!(await confirmSheet({ title: '지금 데이터를 모두 지울까요?', message: '현재 고객과 템플릿이 백업 내용으로 교체됩니다.', ok: '바꾸기', danger: true }))) return;
        await db.clear('customers'); await db.clear('templates'); await db.clear('calls');
      }
      if (Array.isArray(data.calls)) await db.putMany('calls', data.calls.filter((x) => x && x.id));
      const clean = data.customers.filter((c) => c && c.id && c.name).map((c) => ({ ...c, phoneDigits: digitsOnly(c.phone) }));
      await db.putMany('customers', clean);
      if (tn) await db.putMany('templates', data.templates.filter((t) => t && t.id));
      if (data.settings) {
        const cur = await getSettings();
        if (m === 'replace') await saveSettings({ ...data.settings, key: 'app', seeded: true });
        else {
          const sites = [...(cur.sites || [])];
          (data.settings.sites || []).forEach((x) => { if (!sites.some((y) => y.name === x.name)) sites.push(x); });
          await saveSettings({ sites, agentName: cur.agentName || data.settings.agentName || '', agentPhone: cur.agentPhone || data.settings.agentPhone || '', defaultAddress: cur.defaultAddress || data.settings.defaultAddress || '' });
        }
      }
      toast(`고객 ${clean.length}명을 불러왔습니다`);
      ctx.rerender();
    };
  });
}

function toCSV(list) {
  const cols = ['이름', '연락처', '현장', '관심타입', '동호수', '등급', '유입경로', '최초상담일', '최근접촉일', '다음관리일', '방문일', '태그', '관리메모', '상담히스토리'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = list.map((c) => [
    c.name, c.phone, c.site, c.unitType, c.unit, c.grade, c.source, c.firstDate, c.lastContact, c.nextDate, c.visitDate,
    (c.tags || []).join(', '), c.memo,
    (c.history || []).map((h) => `${h.date} [${h.kind}] ${h.text}`).join('\n'),
  ].map(q).join(','));
  return [cols.map(q).join(','), ...rows].join('\r\n');
}

/** 파일 저장: iPhone은 공유 시트(파일에 저장/카톡 등), 그 외는 다운로드 */
async function saveFile(name, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  if (isIOS() && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
