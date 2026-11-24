// 팀 운영: 팀장↔직원 파일 주고받기(배정 파일 / 보고 파일), 합치기, CSV 가져오기
import { db, getSettings, saveSettings } from './db.js';
import { listCustomers, listTemplates, findDuplicate } from './store.js';
import { listCalls, mergeCall } from './calls.js';
import { uid, nowISO, today, digitsOnly, formatPhone, GRADES, SOURCES, isIOS } from './utils.js';

export const isLead = (s) => s.mode === 'lead';
export const isStaff = (s) => s.mode === 'staff';
export const staffName = (s, id) => (s.staff || []).find((x) => x.id === id)?.name || (id ? '알 수 없음' : '미배정');

/** 직원 모드에서는 내 손님만, 팀장/혼자 모드는 전체 */
export function visibleCustomers(list, s) {
  if (isStaff(s) && s.me) return list.filter((c) => !c.owner || c.owner === s.me.id);
  return list;
}

// ---- 합치기 ----
const newerOf = (a, b, key) => ((b?.[key] || '') > (a?.[key] || '') ? b : a);

function mergeById(a = [], b = [], key, stamp) {
  const m = new Map();
  [...a, ...b].forEach((x) => {
    const k = x[key];
    const cur = m.get(k);
    if (!cur) m.set(k, x);
    else if (stamp) m.set(k, newerOf(cur, x, stamp));
    else m.set(k, { ...cur, ...x, deleted: !!(cur.deleted || x.deleted) }); // 히스토리: 한쪽이라도 삭제면 삭제
  });
  return [...m.values()];
}

/**
 * 같은 손님의 두 사본 합치기.
 * 기본 정보는 더 최근에 수정된 쪽, 히스토리는 합집합, 일정·서류는 항목별로 최신.
 * owner(담당 직원)는 팀장 쪽 값이 우선.
 */
export function mergeCustomer(local, incoming, ownerFromIncoming) {
  if (!local) return { ...incoming };
  const base = newerOf(local, incoming, 'updatedAt');
  const merged = {
    ...base,
    history: mergeById(local.history, incoming.history, 'id').sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)),
    schedule: mergeById(local.schedule, incoming.schedule, 'id', 'updatedAt'),
    docs: mergeById(local.docs, incoming.docs, 'name', 't'),
    owner: ownerFromIncoming ? incoming.owner : local.owner,
    updatedAt: [local.updatedAt || '', incoming.updatedAt || ''].sort().pop(),
  };
  merged.phoneDigits = digitsOnly(merged.phone);
  return merged;
}

// ---- 파일 저장 (iPhone/안드로이드: 공유 시트 → 카톡 등, PC: 다운로드) ----
export async function saveFile(name, text, type) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const mobile = isIOS() || /Android/i.test(navigator.userAgent);
  if (mobile && navigator.canShare) {
    const file = new File([blob], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

const stamp = () => today().replace(/-/g, '');

// ---- 팀장 → 직원: 배정 파일 ----
export async function buildAssignPackage(staffId) {
  const s = await getSettings();
  const st = s.staff.find((x) => x.id === staffId);
  const customers = (await listCustomers()).filter((c) => c.owner === staffId);
  return {
    app: 'bunyang-crm', type: 'assign', version: 2, exportedAt: nowISO(),
    leadName: s.agentName, staff: { id: st.id, name: st.name },
    customers, templates: await listTemplates(),
    calls: (await listCalls()).filter((c) => c.owner === staffId),
    settings: { sites: s.sites, cycles: s.cycles, defaultAddress: s.defaultAddress, callKinds: s.callKinds },
  };
}

export async function sendAssignFile(staffId) {
  const pkg = await buildAssignPackage(staffId);
  const ok = await saveFile(`배정_${pkg.staff.name}_${stamp()}.json`, JSON.stringify(pkg), 'application/json');
  if (ok) {
    const s = await getSettings();
    await saveSettings({ staffSync: { ...s.staffSync, [staffId]: { ...(s.staffSync[staffId] || {}), assignAt: pkg.exportedAt } } });
  }
  return pkg.customers.length;
}

// ---- 직원 → 팀장: 보고 파일 ----
export async function sendReportFile() {
  const s = await getSettings();
  if (!s.me) throw new Error('직원 정보 없음');
  const customers = (await listCustomers())
    .filter((c) => !c.owner || c.owner === s.me.id)
    .map((c) => ({ ...c, owner: s.me.id }));
  const calls = (await listCalls())
    .filter((c) => !c.owner || c.owner === s.me.id)
    .map((c) => ({ ...c, owner: s.me.id }));
  const pkg = { app: 'bunyang-crm', type: 'report', version: 2, exportedAt: nowISO(), staff: s.me, customers, calls };
  const ok = await saveFile(`보고_${s.me.name}_${stamp()}.json`, JSON.stringify(pkg), 'application/json');
  if (ok) await saveSettings({ lastReportAt: pkg.exportedAt });
  return customers.length;
}

/** 파일 읽기 → 종류 판별 */
export async function readPackage(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error(`${file.name}: 파일을 읽을 수 없습니다`); }
  if (data.app !== 'bunyang-crm' || !Array.isArray(data.customers)) throw new Error(`${file.name}: 이 앱의 파일이 아닙니다`);
  return data;
}

/** (직원) 팀장 배정 파일 불러오기 */
export async function importAssign(pkg) {
  const s = await getSettings();
  const local = await listCustomers();
  const byId = new Map(local.map((c) => [c.id, c]));
  const incomingIds = new Set(pkg.customers.map((c) => c.id));
  let added = 0, updated = 0, removed = 0;
  const out = pkg.customers.map((c) => {
    const cur = byId.get(c.id);
    if (cur) updated++; else added++;
    return { ...mergeCustomer(cur, c, true), synced: true };
  });
  await db.putMany('customers', out);
  // 팀장 쪽에서 빠진 손님(재배정·삭제) 정리: 예전에 받은 손님(synced)만 지운다. 직원이 새로 등록한 손님은 유지.
  for (const c of local) {
    if (c.synced && !incomingIds.has(c.id)) { await db.del('customers', c.id); removed++; }
  }
  // 콜: 같은 방식으로 합치고, 팀장 쪽에서 빠진(재배정·삭제) 받은 콜은 정리
  let calls = 0;
  if (Array.isArray(pkg.calls)) {
    const localCalls = await listCalls();
    const cById = new Map(localCalls.map((c) => [c.id, c]));
    const inIds = new Set(pkg.calls.map((c) => c.id));
    await db.putMany('calls', pkg.calls.map((c) => ({ ...mergeCall(cById.get(c.id), c, true), synced: true })));
    for (const c of localCalls) if (c.synced && !inIds.has(c.id)) await db.del('calls', c.id);
    calls = pkg.calls.length;
  }
  // 템플릿: 없는 것만 추가
  const tpls = await db.all('templates');
  const haveIds = new Set(tpls.map((t) => t.id));
  const newTpls = (pkg.templates || []).filter((t) => t && t.id && !haveIds.has(t.id));
  if (newTpls.length) await db.putMany('templates', newTpls);
  await saveSettings({
    mode: 'staff', me: pkg.staff, leadName: pkg.leadName || s.leadName,
    agentName: s.agentName || pkg.staff.name,
    sites: pkg.settings?.sites || s.sites, cycles: pkg.settings?.cycles || s.cycles,
    callKinds: pkg.settings?.callKinds || s.callKinds,
    defaultAddress: s.defaultAddress || pkg.settings?.defaultAddress || '',
    lastAssignAt: nowISO(), seeded: true,
  });
  return { added, updated, removed, calls };
}

/** (팀장) 직원 보고 파일 불러오기 */
export async function importReport(pkg) {
  const s = await getSettings();
  let staff = s.staff.find((x) => x.id === pkg.staff?.id);
  if (!staff) { // 처음 보는 직원이면 팀원으로 추가
    staff = { id: pkg.staff.id || uid(), name: pkg.staff.name || '이름없음', phone: '' };
    s.staff.push(staff);
  }
  const local = new Map((await listCustomers()).map((c) => [c.id, c]));
  let added = 0, updated = 0;
  const out = pkg.customers.map((c) => {
    const cur = local.get(c.id);
    if (cur) { updated++; return mergeCustomer(cur, c, false); }
    added++;
    return { ...c, owner: staff.id };
  });
  await db.putMany('customers', out);
  if (Array.isArray(pkg.calls) && pkg.calls.length) {
    const lc = new Map((await listCalls()).map((c) => [c.id, c]));
    await db.putMany('calls', pkg.calls.map((c) => {
      const cur = lc.get(c.id);
      const m = cur ? mergeCall(cur, c, false) : { ...c, owner: staff.id };
      delete m.synced;
      return m;
    }));
  }
  const prev = s.staffSync[staff.id] || {};
  await saveSettings({
    staff: s.staff,
    staffSync: { ...s.staffSync, [staff.id]: { ...prev, reportAt: [prev.reportAt || '', pkg.exportedAt].sort().pop(), importedAt: nowISO(), count: pkg.customers.length } },
  });
  return { staff: staff.name, added, updated };
}

// ---- 엑셀(CSV) 가져오기 ----
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (e) {
    return new TextDecoder('euc-kr').decode(buf); // 엑셀 기본 CSV(한글 윈도우)
  }
}

export function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const HEAD = {
  name: ['이름', '고객명', '성명', '손님'], phone: ['연락처', '전화번호', '휴대폰', '핸드폰', '번호'],
  site: ['현장', '현장명'], unitType: ['관심타입', '타입', '평형', '관심평형'], unit: ['동호수', '동·호수', '호수'],
  grade: ['등급'], source: ['유입경로', '유입'], firstDate: ['최초상담일', '상담일', '등록일'], lastContact: ['최근접촉일'],
  nextDate: ['다음관리일', '관리일'], visitDate: ['방문일', '방문예약일'], visitTime: ['방문시간'], tags: ['태그'],
  memo: ['관리메모', '메모', '비고'], owner: ['담당', '담당자', '담당직원', '직원'],
};
const normDate = (v) => {
  const m = String(v || '').trim().match(/^(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

/** CSV 파일 → 미리보기용 결과 (저장은 commitCSV) */
export async function previewCSV(file) {
  const rows = parseCSV(await decodeFile(file));
  if (rows.length < 2) throw new Error('내용이 없습니다');
  const head = rows[0].map((h) => h.replace(/\s/g, ''));
  const col = {};
  Object.entries(HEAD).forEach(([k, names]) => { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; });
  if (col.name === undefined || col.phone === undefined) throw new Error('첫 줄에 "이름"과 "연락처" 열이 있어야 합니다');
  const s = await getSettings();
  const out = [];
  for (const r of rows.slice(1)) {
    const g = (k) => (col[k] !== undefined ? (r[col[k]] || '').trim() : '');
    if (!g('name') || digitsOnly(g('phone')).length < 9) continue;
    const ownerName = g('owner');
    const owner = (s.staff || []).find((x) => x.name === ownerName)?.id || '';
    out.push({
      name: g('name'), phone: formatPhone(g('phone')), site: g('site'), unitType: g('unitType'), unit: g('unit'),
      grade: GRADES.includes(g('grade')) ? g('grade') : 'B', source: SOURCES.includes(g('source')) ? g('source') : '',
      firstDate: normDate(g('firstDate')) || today(), lastContact: normDate(g('lastContact')), nextDate: normDate(g('nextDate')),
      visitDate: normDate(g('visitDate')), visitTime: g('visitTime'),
      tags: g('tags').split(/[,#]/).map((x) => x.trim()).filter(Boolean), memo: g('memo'),
      owner, ownerName, dup: !!(await findDuplicate(g('phone'))),
    });
  }
  return { rows: out, columns: Object.keys(col) };
}

export async function commitCSV(rows, { skipDup = true, owner = '' } = {}) {
  const now = nowISO();
  const list = rows.filter((r) => !(skipDup && r.dup)).map(({ dup, ownerName, ...r }) => ({
    ...r, id: uid(), phoneDigits: digitsOnly(r.phone), owner: r.owner || owner,
    history: [{ id: uid(), date: r.firstDate || today(), kind: '상담', text: '엑셀에서 가져옴' }],
    schedule: [], docs: [], createdAt: now, updatedAt: now,
  }));
  await db.putMany('customers', list);
  return list.length;
}
