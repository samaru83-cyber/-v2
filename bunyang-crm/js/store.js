// 고객·히스토리·계약 일정·서류·템플릿 데이터 로직
import { db, getSettings } from './db.js';
import { uid, today, addDays, digitsOnly, formatPhone, nowISO, PAY_KINDS, DEFAULT_DOCS } from './utils.js';

export async function listCustomers() {
  return db.all('customers');
}

export const getCustomer = (id) => db.get('customers', id);

/** 같은 번호의 다른 고객 찾기 (중복 경고용) */
export async function findDuplicate(phone, exceptId) {
  const d = digitsOnly(phone);
  if (d.length < 9) return null;
  const list = await db.byPhone(d);
  return list.find((c) => c.id !== exceptId) || null;
}

export async function saveCustomer(c) {
  const now = nowISO();
  const rec = {
    history: [], tags: [], schedule: [], docs: [], owner: '',
    ...c,
    id: c.id || uid(),
    phone: formatPhone(c.phone),
    phoneDigits: digitsOnly(c.phone),
    createdAt: c.createdAt || now,
    updatedAt: now,
  };
  await db.put('customers', rec);
  return rec;
}

export const deleteCustomer = (id) => db.del('customers', id);

/** 고객 하나를 읽어 수정 함수 적용 후 저장 */
export async function patchCustomer(id, fn) {
  const c = await getCustomer(id);
  if (!c) return null;
  await fn(c);
  return saveCustomer(c);
}

/** 등급별 관리주기로 다음 관리일 계산 */
export async function nextByGrade(grade, from = today()) {
  const s = await getSettings();
  const days = s.cycles[grade] ?? 7;
  return addDays(from, days);
}

// 삭제 표시(tombstone)된 항목은 화면에서 숨긴다. 파일 합치기 때 삭제가 되살아나지 않게 하기 위함.
export const liveHistory = (c) => (c.history || []).filter((h) => !h.deleted);
export const liveSchedule = (c) => (c.schedule || []).filter((s) => !s.deleted).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

const sortHistory = (list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/**
 * 접촉 기록 추가. opts.next: 'auto' | 'keep' | 'YYYY-MM-DD'
 * 날짜가 최근접촉일보다 같거나 이후면 최근접촉일 갱신.
 */
export async function addHistory(id, { date = today(), kind = '상담', text = '' }, opts = {}) {
  const c = await getCustomer(id);
  if (!c) return null;
  c.history = sortHistory([{ id: uid(), date, kind, text }, ...(c.history || [])]);
  if (!c.lastContact || date >= c.lastContact) c.lastContact = date;
  const next = opts.next || 'keep';
  if (next === 'auto') c.nextDate = await nextByGrade(c.grade, date);
  else if (next !== 'keep') c.nextDate = next;
  return saveCustomer(c);
}

export const removeHistory = (id, hid) => patchCustomer(id, (c) => {
  const h = (c.history || []).find((x) => x.id === hid);
  if (h) h.deleted = true;
});

// ---- 계약 일정 (계약금·중도금·잔금·계약서·서류) ----
export const isPayKind = (kind) => PAY_KINDS.includes(kind);

export const upsertSchedule = (id, item) => patchCustomer(id, (c) => {
  c.schedule = c.schedule || [];
  const rec = { done: false, doneDate: '', amount: 0, memo: '', ...item, id: item.id || uid(), updatedAt: nowISO() };
  const i = c.schedule.findIndex((x) => x.id === rec.id);
  if (i >= 0) c.schedule[i] = rec; else c.schedule.push(rec);
});

export const toggleSchedule = (id, sid, done) => patchCustomer(id, (c) => {
  const s = (c.schedule || []).find((x) => x.id === sid);
  if (!s) return;
  s.done = done ?? !s.done;
  s.doneDate = s.done ? today() : '';
  s.updatedAt = nowISO();
  const label = isPayKind(s.kind) ? (s.done ? '입금 확인' : '입금 확인 취소') : (s.done ? '완료' : '완료 취소');
  c.history = sortHistory([{ id: uid(), date: today(), kind: '계약', text: `${s.kind} ${label}` }, ...(c.history || [])]);
});

export const removeSchedule = (id, sid) => patchCustomer(id, (c) => {
  const s = (c.schedule || []).find((x) => x.id === sid);
  if (s) { s.deleted = true; s.updatedAt = nowISO(); }
});

// ---- 서류 체크리스트 ----
export const initDocs = (id) => patchCustomer(id, (c) => {
  const have = new Set((c.docs || []).map((d) => d.name));
  c.docs = [...(c.docs || []), ...DEFAULT_DOCS.filter((n) => !have.has(n)).map((name) => ({ name, done: false, t: nowISO() }))];
});
export const toggleDoc = (id, name) => patchCustomer(id, (c) => {
  const d = (c.docs || []).find((x) => x.name === name);
  if (d) { d.done = !d.done; d.t = nowISO(); }
});
export const addDoc = (id, name) => patchCustomer(id, (c) => {
  c.docs = c.docs || [];
  const d = c.docs.find((x) => x.name === name);
  if (d) { d.deleted = false; d.t = nowISO(); } else c.docs.push({ name, done: false, t: nowISO() });
});
export const removeDoc = (id, name) => patchCustomer(id, (c) => {
  const d = (c.docs || []).find((x) => x.name === name);
  if (d) { d.deleted = true; d.t = nowISO(); }
});
export const liveDocs = (c) => (c.docs || []).filter((d) => !d.deleted);
export const missingDocs = (c) => liveDocs(c).filter((d) => !d.done);

/**
 * 고객의 일정을 하나의 목록으로: 관리일 / 방문 예약 / 입금 / 계약·서류
 * type: care | visit | pay | contract
 */
export function eventsOf(c) {
  const ev = [];
  if (c.nextDate) ev.push({ date: c.nextDate, type: 'care', label: '관리', c });
  if (c.visitDate) ev.push({ date: c.visitDate, time: c.visitTime || '', type: 'visit', label: '방문', done: !!c.visitDone, c });
  liveSchedule(c).forEach((s) => {
    if (s.date) ev.push({ date: s.date, type: isPayKind(s.kind) ? 'pay' : 'contract', label: s.kind, amount: s.amount, done: !!s.done, item: s, c });
  });
  return ev;
}

// ---- 템플릿 ----
export async function listTemplates() {
  const list = await db.all('templates');
  return list.sort((a, b) => (b.favorite - a.favorite) || (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title));
}
export const saveTemplate = (t) => db.put('templates', { favorite: false, ...t, id: t.id || uid() });
export const deleteTemplate = (id) => db.del('templates', id);

export const TEMPLATE_CATEGORIES = [
  '첫 상담 감사', '견본주택 방문 예약 확인', '방문 전날 리마인드', '청약 일정 안내',
  '당첨자 발표 안내', '계약 축하', '미계약 재접촉', '잔여세대 안내', '명절·안부', '기타',
];
