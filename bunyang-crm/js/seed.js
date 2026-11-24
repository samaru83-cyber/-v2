// 샘플 데이터(테스트용 고객 10명)와 기본 문자 템플릿
import { db, saveSettings, getSettings } from './db.js';
import { today, addDays, uid, formatPhone, digitsOnly, DEFAULT_DOCS } from './utils.js';

export const DEFAULT_TEMPLATES = [
  { category: '첫 상담 감사', title: '첫 상담 감사',
    body: '{고객명} 고객님, 안녕하세요.\n{현장명} 분양상담사 {상담사명}입니다.\n오늘 귀한 시간 내어 상담해 주셔서 감사합니다.\n관심 주신 {평형} 타입 관련해 궁금하신 점은 언제든 편하게 연락 주세요.\n{상담사명} 드림 / {상담사연락처}' },
  { category: '견본주택 방문 예약 확인', title: '방문 예약 확인',
    body: '{고객명} 고객님, {현장명} 견본주택 방문 예약이 확정되었습니다.\n■ 방문일: {방문일}\n■ 주소: {견본주택주소}\n■ 담당: {상담사명} ({상담사연락처})\n도착하시면 담당자 이름을 말씀해 주세요. 감사합니다.' },
  { category: '방문 전날 리마인드', title: '방문 전날 리마인드',
    body: '{고객명} 고객님, 내일({방문일}) {현장명} 견본주택 방문 일정 안내드립니다.\n주소: {견본주택주소}\n일정 변경이 필요하시면 편하게 연락 주세요.\n{상담사명} {상담사연락처}' },
  { category: '청약 일정 안내', title: '청약 일정 안내',
    body: '{고객명} 고객님, {현장명} 청약 일정 안내드립니다.\n■ 특별공급: \n■ 1순위: \n■ 2순위: \n청약홈(applyhome.co.kr)에서 신청 가능하며, 준비 서류나 자격 관련해 도움이 필요하시면 연락 주세요.\n{상담사명} {상담사연락처}' },
  { category: '당첨자 발표 안내', title: '당첨자 발표 안내',
    body: '{고객명} 고객님, {현장명} 당첨자 발표 안내드립니다.\n■ 발표일: \n청약홈에서 당첨 여부를 확인하실 수 있습니다.\n결과 확인 후 계약 일정과 준비 서류를 바로 안내해 드리겠습니다.\n{상담사명} {상담사연락처}' },
  { category: '계약 축하', title: '계약 축하',
    body: '{고객명} 고객님, {현장명} {평형} 계약을 진심으로 축하드립니다!\n입주까지 필요한 안내는 제가 꼼꼼히 챙겨드리겠습니다.\n앞으로도 잘 부탁드립니다.\n{상담사명} 드림 / {상담사연락처}' },
  { category: '미계약 재접촉', title: '미계약 재접촉',
    body: '{고객명} 고객님, 안녕하세요. {현장명} {상담사명}입니다.\n지난번 상담 이후 고민 많으셨죠?\n최근 조건 변경 사항이 있어 안내드리고 싶어 연락드렸습니다.\n편하신 시간에 통화 가능하실까요?\n{상담사연락처}' },
  { category: '잔여세대 안내', title: '잔여세대 안내',
    body: '{고객명} 고객님, {현장명} 잔여세대 안내드립니다.\n관심 주셨던 {평형} 타입 일부 세대가 선착순으로 나왔습니다.\n좋은 동·호수는 빠르게 마감되니 관심 있으시면 연락 주세요.\n견본주택: {견본주택주소}\n{상담사명} {상담사연락처}' },
  { category: '명절·안부', title: '명절 안부',
    body: '{고객명} 고객님, 즐거운 명절 보내고 계신가요?\n가족분들과 따뜻하고 행복한 시간 보내시길 바랍니다.\n{현장명} {상담사명} 드림' },
];

const SAMPLE = [
  // [이름, 번호끝, 현장 idx, 평형, 동호, 등급, 유입, 최초상담(일전), 최근접촉(일전), 다음관리(일후), 메모, 태그, 방문일(일후)]
  ['김민수', '1001', 0, '84A', '103동 1502호', 'S', '현수막', 20, 4, -2, '84A 남향 고층 희망. 중도금 대출 문의', ['실거주', '대출문의'], null],
  ['이영희', '1002', 0, '59', '', 'A', '지인', 15, 3, 0, '부모님 거주용. 엘리베이터 가까운 동 선호', ['부모님'], 1],
  ['박지훈', '1003', 1, '74', '', 'B', '광고', 30, 5, 2, '투자 목적. 전매 제한 기간 질문', ['투자'], null],
  ['최수진', '1004', 0, '84B', '', 'A', '워킹', 10, 3, 0, '신혼부부 특공 대상. 서류 준비 중', ['특공', '신혼'], 0],
  ['정우성', '1005', 1, '101', '', 'C', '콜', 45, 14, 7, '가격 부담 언급. 잔여세대 나오면 연락 원함', ['잔여세대'], null],
  ['한지민', '1006', 0, '84A', '105동 802호', '계약', '지인', 60, 2, 28, '11월 계약 완료. 옵션 계약 안내 필요', ['계약자'], null],
  ['오세훈', '1007', 1, '59', '', 'B', '현수막', 25, 8, -1, '주말에만 통화 가능', ['주말통화'], null],
  ['윤아름', '1008', 0, '74', '', 'S', '광고', 7, 1, 1, '오늘 견본주택 재방문 예정. 계약 의사 높음', ['VIP'], 3],
  ['강동원', '1009', 1, '84B', '102동 1101호', '계약', '워킹', 50, 3, 1, '계약금 2차 입금 지연. 기존 주택 매도 자금 대기', ['계약자', '입금지연'], null],
  ['서예지', '1010', 0, '59', '', 'C', '콜', 12, 6, 3, '청약 일정 문의만 함', [], null],
];

export const SAMPLE_SITES = [
  { name: '이천역 센트럴', address: '경기 이천시 중리동 123 견본주택' },
  { name: '오포 더힐', address: '경기 광주시 오포읍 45 견본주택' },
];

export const SAMPLE_STAFF = [
  { id: 'sample-s1', name: '김대리', phone: '010-0000-2001' },
  { id: 'sample-s2', name: '이주임', phone: '010-0000-2002' },
  { id: 'sample-s3', name: '박사원', phone: '010-0000-2003' },
];

// 담당 직원(o), 방문 시간/일(vt, vd), 계약 일정 [구분, 일(오늘 기준), 금액(만원), 완료], 완료된 서류 수
const EXTRA = {
  김민수: { o: 0 },
  이영희: { o: 0, vt: '14:00' },
  박지훈: { o: 1 },
  최수진: { o: 1, vt: '11:00' },
  정우성: { o: 2 },
  한지민: { o: 0, sch: [['계약서 작성', -10, 0, true], ['계약금 1차', -10, 1000, true], ['계약금 2차', 0, 2500, false], ['중도금 대출서류', 5, 0, false]], docs: 4 },
  오세훈: { o: 2, vd: 0, vt: '16:30' },
  윤아름: { o: 2, vd: 0, vt: '10:30' },
  강동원: { o: 1, sch: [['계약서 작성', -14, 0, true], ['계약금 1차', -14, 1000, true], ['계약금 2차', -2, 2800, false], ['잔금', 400, 0, false]], docs: 5 },
  서예지: { o: 0 },
};

export function buildSampleCustomers(ownerIds = []) {
  const t = today();
  const now = new Date().toISOString();
  return SAMPLE.map(([name, tail, si, unitType, unit, grade, source, first, last, next, memo, tags, visit]) => {
    const x = EXTRA[name] || {};
    const phone = formatPhone('0100000' + tail);
    const history = [
      { id: uid(), date: addDays(t, -last), kind: '전화', text: '관리 통화. ' + memo },
      { id: uid(), date: addDays(t, -first), kind: '상담', text: `최초 상담 (${source})` },
    ];
    const vd = x.vd !== undefined ? x.vd : visit;
    const schedule = (x.sch || []).map(([kind, d, amount, done]) => ({
      id: uid(), kind, date: addDays(t, d), amount, done, doneDate: done ? addDays(t, d) : '', memo: '', updatedAt: now,
    }));
    const docs = x.docs !== undefined ? DEFAULT_DOCS.map((n, i) => ({ name: n, done: i < x.docs, t: now })) : [];
    return {
      id: uid(), name, phone, phoneDigits: digitsOnly(phone), site: SAMPLE_SITES[si].name,
      unitType, unit, grade, source, firstDate: addDays(t, -first), lastContact: addDays(t, -last),
      nextDate: addDays(t, next), visitDate: vd === null || vd === undefined ? '' : addDays(t, vd), visitTime: vd === null || vd === undefined ? '' : (x.vt || ''),
      visitDone: false, memo, history, tags, schedule, docs,
      owner: ownerIds[x.o] || '', createdAt: now, updatedAt: now, sample: true,
    };
  });
}

/** 최초 실행 시 기본 템플릿 설치 */
export async function ensureDefaults() {
  const s = await getSettings();
  const existing = await db.all('templates');
  if (!s.seeded && existing.length === 0) {
    await db.putMany('templates', DEFAULT_TEMPLATES.map((tp, i) => ({ ...tp, id: uid(), order: i, favorite: i < 3 })));
  }
  if (!s.seeded) await saveSettings({ seeded: true });
}

/** 설정 화면의 [샘플 고객 넣기] */
export async function loadSampleData() {
  const s = await getSettings();
  const patch = {};
  let list;
  if (s.mode === 'lead') {
    // 팀장: 샘플 직원 3명에게 나눠 배정
    const staff = [...(s.staff || [])];
    SAMPLE_STAFF.forEach((x) => { if (!staff.some((y) => y.id === x.id)) staff.push(x); });
    patch.staff = staff;
    list = buildSampleCustomers(SAMPLE_STAFF.map((x) => x.id));
  } else if (s.mode === 'staff' && s.me) {
    list = buildSampleCustomers([s.me.id, '', '']).filter((c) => c.owner === s.me.id).map((c) => ({ ...c, owner: s.me.id }));
  } else {
    list = buildSampleCustomers();
  }
  await db.putMany('customers', list);
  const ownerIds = s.mode === 'lead' ? SAMPLE_STAFF.map((x) => x.id) : s.mode === 'staff' && s.me ? [s.me.id, s.me.id, s.me.id] : ['', '', ''];
  let calls = buildSampleCalls(ownerIds, list);
  if (s.mode === 'staff' && s.me) calls = calls.filter((c, i) => i % 3 === 0);
  await db.putMany('calls', calls);
  const sites = [...(s.sites || [])];
  SAMPLE_SITES.forEach((ss) => { if (!sites.some((x) => x.name === ss.name)) sites.push(ss); });
  await saveSettings({
    ...patch, sites,
    agentName: s.agentName || '홍길동',
    agentPhone: s.agentPhone || '010-0000-9999',
  });
  return list.length;
}

// 샘플 콜: [종류, 며칠 전, 시각, 담당(0~2), 이름, 번호 끝자리 또는 연결 고객명, 결과, 메모]
const SAMPLE_CALLS = [
  ['광고콜', 0, '15:10', 0, '', '3011', '', '84 문의, 조건 물어봄'],
  ['회사콜', 0, '11:40', 2, '문정호', '3012', '', '59 관심'],
  ['광고콜', 0, '09:50', 1, '배수정', '3013', '통화', '주말 방문 고민'],
  ['현수막콜', 1, '17:20', 2, '', '3014', '', '전화 다시 달라고 함'],
  ['광고콜', 2, '13:05', 1, '조민아', '3015', '', ''],
  ['현수막콜', 2, '10:30', 2, '@오세훈', '', '방문예약', '오늘 오후 방문'],
  ['회사콜', 3, '16:00', 0, '@이영희', '', '방문예약', '내일 방문 예약'],
  ['광고콜', 4, '14:40', 0, '', '3016', '무효', '잘못 건 전화'],
  ['회사콜', 5, '11:15', 1, '@박지훈', '', '통화', '전매 가능 여부 문의'],
  ['광고콜', 6, '15:30', 2, '@윤아름', '', '방문예약', ''],
  ['지인소개', 7, '10:00', 1, '@최수진', '', '방문', '지인 소개'],
  ['광고콜', 8, '18:10', 0, '홍성민', '3017', '부재', '두 번 부재'],
  ['회사콜', 9, '12:20', 2, '임태호', '3018', '통화', '청약 통장 없음'],
  ['현수막콜', 10, '09:40', 1, '', '3019', '무효', ''],
  ['회사콜', 14, '14:00', 0, '@한지민', '', '계약', ''],
  ['광고콜', 16, '16:45', 1, '@강동원', '', '계약', ''],
  ['광고콜', 18, '11:00', 2, '@정우성', '', '통화', ''],
  ['회사콜', 20, '13:30', 0, '@김민수', '', '방문', ''],
];

export function buildSampleCalls(ownerIds, customers) {
  const t = today();
  return SAMPLE_CALLS.map(([kind, ago, time, o, name, tail, result, memo], i) => {
    const date = addDays(t, -ago);
    let atD = new Date(`${date}T${time}:00`);
    if (atD > new Date()) atD = new Date(Date.now() - (i + 1) * 25 * 60000); // 오늘 샘플은 지금보다 이전 시각으로
    const at = atD.toISOString();
    const cust = name.startsWith('@') ? customers.find((c) => c.name === name.slice(1)) : null;
    const phone = cust ? cust.phone : formatPhone('0100000' + tail);
    return {
      id: uid(), kind, at, date, name: cust ? cust.name : name, phone, phoneDigits: digitsOnly(phone), memo,
      owner: ownerIds[o] || '', result, resultAt: result ? at : '', customerId: cust ? cust.id : '',
      createdAt: at, updatedAt: at, sample: true,
    };
  });
}

export async function removeSampleData() {
  const all = await db.all('customers');
  await Promise.all(all.filter((c) => c.sample).map((c) => db.del('customers', c.id)));
  const calls = await db.all('calls');
  await Promise.all(calls.filter((c) => c.sample).map((c) => db.del('calls', c.id)));
  const s = await getSettings();
  if (s.staff && s.staff.some((x) => x.id.startsWith('sample-'))) {
    await saveSettings({ staff: s.staff.filter((x) => !x.id.startsWith('sample-')) });
  }
}
