// 공통 유틸: 날짜, D-day, 전화번호, 템플릿 치환, HTML 이스케이프

export const GRADES = ['S', 'A', 'B', 'C', '계약', '보류'];
export const SOURCES = ['현수막', '지인', '광고', '워킹', '콜'];
export const CONTACT_KINDS = ['전화', '문자', '방문', '상담', '기타'];
// 계약 일정 구분: 입금 일정(pay) / 계약·서류 일정(contract)
export const SCHEDULE_KINDS = ['계약서 작성', '계약금 1차', '계약금 2차', '중도금 대출서류', '중도금', '잔금', '기타'];
export const PAY_KINDS = ['계약금 1차', '계약금 2차', '중도금', '잔금'];
export const DEFAULT_DOCS = ['신분증', '주민등록등본', '주민등록초본', '가족관계증명서', '인감증명서', '인감도장', '계약금 입금증'];
export const fmtMoney = (man) => (man ? `${Number(man).toLocaleString('ko-KR')}만원` : '');
export const isWide = () => matchMedia('(min-width: 1024px)').matches;
export const nowISO = () => new Date().toISOString();

/** '오늘 18:20' / '어제 09:10' / '3일 전' */
export function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = diffDays(toYMD(d), today());
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `오늘 ${hm}`;
  if (days === 1) return `어제 ${hm}`;
  return `${days}일 전`;
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// ---- 날짜 (모두 로컬 기준 'YYYY-MM-DD' 문자열) ----
const pad = (n) => String(n).padStart(2, '0');
export const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => toYMD(new Date());
export function addDays(ymd, n) { const d = parseYMD(ymd); d.setDate(d.getDate() + n); return toYMD(d); }
export function diffDays(from, to) { return Math.round((parseYMD(to) - parseYMD(from)) / 86400000); }

/** 다음 관리일까지 남은 일수: 양수=남음, 0=오늘, 음수=지남 */
export const daysLeft = (next) => (next ? diffDays(today(), next) : null);

export function ddayLabel(next) {
  const n = daysLeft(next);
  if (n === null) return '미지정';
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** overdue | today | soon(1~3일) | later | none */
export function bucketOf(next) {
  const n = daysLeft(next);
  if (n === null) return 'none';
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 3) return 'soon';
  return 'later';
}

export function weekRange(ymd = today()) {
  const d = parseYMD(ymd);
  const dow = (d.getDay() + 6) % 7; // 월=0
  const start = addDays(ymd, -dow);
  return [start, addDays(start, 6)];
}

export function fmtDate(ymd, withWeek = true) {
  if (!ymd) return '-';
  const d = parseYMD(ymd);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` + (withWeek ? ` (${WEEK[d.getDay()]})` : '');
}
export function fmtShort(ymd) {
  if (!ymd) return '-';
  const d = parseYMD(ymd);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEK[d.getDay()]})`;
}

// ---- 전화번호 ----
export const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

export function formatPhone(input) {
  const d = digitsOnly(input).slice(0, 11);
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length === 8 && /^(15|16|18)/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 1588-xxxx
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

// ---- 기타 ----
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const TEMPLATE_VARS = ['{고객명}', '{현장명}', '{평형}', '{방문일}', '{상담사명}', '{상담사연락처}', '{견본주택주소}'];

/** 고객·설정 정보로 템플릿 변수 채우기. 값이 없으면 변수를 그대로 남겨 눈에 띄게 한다. */
export function fillTemplate(body, customer, settings) {
  const site = (settings.sites || []).find((s) => s.name === customer?.site);
  const map = {
    '{고객명}': customer?.name,
    '{현장명}': customer?.site,
    '{평형}': customer?.unitType,
    '{방문일}': customer?.visitDate ? fmtShort(customer.visitDate) : '',
    '{상담사명}': settings.agentName,
    '{상담사연락처}': settings.agentPhone,
    '{견본주택주소}': (site && site.address) || settings.defaultAddress,
  };
  return body.replace(/\{[^{}]+\}/g, (k) => (map[k] ? map[k] : k));
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 문자앱 링크: iOS는 &body=, Android는 ?body= */
export function smsLink(phone, body = '') {
  const to = digitsOnly(phone);
  if (!body) return `sms:${to}`;
  return `sms:${to}${isIOS() ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export function gradeClass(g) {
  return { S: 'g-s', A: 'g-a', B: 'g-b', C: 'g-c', 계약: 'g-done', 보류: 'g-hold' }[g] || 'g-c';
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
