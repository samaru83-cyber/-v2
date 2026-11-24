// 콜 배분 기록: 팀장이 직원에게 준 콜(회사콜·광고콜 등)과 처리 결과
import { db } from './db.js';
import { listCustomers, saveCustomer, liveHistory, liveSchedule } from './store.js';
import { uid, nowISO, today, toYMD, digitsOnly, formatPhone, addDays } from './utils.js';

// 결과 단계. rank가 클수록 더 진행된 것. 무효는 따로 셈
export const RESULTS = [
  { k: '', label: '미처리', rank: 0 },
  { k: '부재', label: '부재', rank: 1 },
  { k: '통화', label: '통화완료', rank: 2 },
  { k: '방문예약', label: '방문예약', rank: 3 },
  { k: '방문', label: '방문', rank: 4 },
  { k: '계약', label: '계약', rank: 5 },
  { k: '무효', label: '무효', rank: -1 },
];
const RANK = Object.fromEntries(RESULTS.map((r) => [r.k, r.rank]));
export const resultLabel = (k) => RESULTS.find((r) => r.k === (k || ''))?.label || '미처리';

export async function listCalls() {
  return (await db.all('calls')).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export async function saveCall(c) {
  const now = nowISO();
  const rec = {
    result: '', memo: '', owner: '', customerId: '', ...c,
    id: c.id || uid(), at: c.at || now, phone: formatPhone(c.phone || ''), createdAt: c.createdAt || now, updatedAt: now,
  };
  rec.phoneDigits = digitsOnly(rec.phone);
  rec.date = toYMD(new Date(rec.at));
  await db.put('calls', rec);
  return rec;
}

export const deleteCall = (id) => db.del('calls', id);

export async function setResult(id, result) {
  const c = await db.get('calls', id);
  if (!c) return null;
  return saveCall({ ...c, result, resultAt: result ? nowISO() : '' });
}

/** 같은 번호로 이미 준 콜·이미 등록된 고객 찾기 */
export async function findPhoneDup(phone, exceptId) {
  const d = digitsOnly(phone);
  if (d.length < 9) return { calls: [], customer: null };
  const calls = (await listCalls()).filter((x) => x.phoneDigits === d && x.id !== exceptId);
  const customer = (await db.byPhone(d))[0] || null;
  return { calls, customer };
}

/**
 * 실제 진행 단계: 직원이 고른 결과와, 연결된 고객 카드(방문 확인·계약) 중 더 앞선 것.
 * 고객 카드에서 방문 확인이나 계약서 작성을 체크하면 콜 성과에도 자동 반영된다.
 */
export function stageOf(call, custById) {
  let r = call.result || '';
  if (r === '무효') return r;
  const c = call.customerId && custById.get(call.customerId);
  if (c) {
    const contracted = c.grade === '계약' || liveSchedule(c).some((it) => it.kind === '계약서 작성' && it.done);
    const visited = c.visitDone || liveHistory(c).some((h) => h.kind === '방문');
    const reserved = c.visitDate && c.visitDate >= (call.date || '');
    const derived = contracted ? '계약' : visited ? '방문' : reserved ? '방문예약' : '';
    if ((RANK[derived] || 0) > (RANK[r] || 0)) r = derived;
  }
  return r;
}
export const rankOf = (k) => RANK[k || ''] ?? 0;

/** 콜 → 고객 카드 만들기 (이미 있으면 연결만) */
export async function convertToCustomer(call, s) {
  const dup = call.phoneDigits ? (await db.byPhone(call.phoneDigits))[0] : null;
  let cust = dup;
  if (!cust) {
    const t = today();
    const source = /광고/.test(call.kind) ? '광고' : /현수막/.test(call.kind) ? '현수막' : /지인/.test(call.kind) ? '지인' : '콜';
    const grade = rankOf(call.result) >= 3 ? 'A' : 'B';
    cust = await saveCustomer({
      name: call.name || '이름 미상', phone: call.phone, site: s.sites[0]?.name || '', unitType: '', unit: '',
      grade, source, firstDate: call.date || t, lastContact: t, nextDate: addDays(t, s.cycles[grade] || 7),
      visitDate: '', visitTime: '', memo: call.memo || '', tags: [call.kind].filter(Boolean),
      history: [{ id: uid(), date: call.date || t, kind: '상담', text: `${call.kind || '콜'} 배정${call.memo ? ` · ${call.memo}` : ''}` }],
      owner: call.owner || '',
    });
  }
  await saveCall({ ...call, customerId: cust.id, result: call.result || '통화' });
  return cust;
}

/** 기간 필터 */
export function periodStart(p) {
  const t = today();
  if (p === 'today') return t;
  if (p === 'week') return addDays(t, -((new Date().getDay() + 6) % 7)); // 이번 주 월요일
  if (p === 'month') return t.slice(0, 7) + '-01';
  return '';
}

/** 묶음별 성과 집계: 받은 콜, 미처리, 통화 이상, 방문, 계약, 무효 */
export function tally(calls, custById) {
  const o = { n: 0, todo: 0, reach: 0, visit: 0, contract: 0, invalid: 0 };
  calls.forEach((c) => {
    const st = stageOf(c, custById);
    o.n++;
    if (st === '무효') { o.invalid++; return; }
    const r = rankOf(st);
    if (r === 0) o.todo++;
    if (r >= 2) o.reach++;
    if (r >= 4) o.visit++;
    if (r >= 5) o.contract++;
  });
  const base = o.n - o.invalid;
  o.visitRate = base ? Math.round((o.visit / base) * 100) : 0;
  o.contractRate = base ? Math.round((o.contract / base) * 100) : 0;
  return o;
}

export async function customersById() {
  return new Map((await listCustomers()).map((c) => [c.id, c]));
}

/** 하루 넘게 결과가 없는 콜 */
export const isStale = (c) => !c.result && c.at && (Date.now() - new Date(c.at).getTime()) > 24 * 3600 * 1000;

export function mergeCall(local, incoming, ownerFromIncoming) {
  if (!local) return { ...incoming };
  const base = (incoming.updatedAt || '') > (local.updatedAt || '') ? incoming : local;
  return { ...base, owner: ownerFromIncoming ? incoming.owner : local.owner, customerId: base.customerId || local.customerId || incoming.customerId };
}
