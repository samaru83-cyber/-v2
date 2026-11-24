// IndexedDB 저장소. 모든 데이터는 이 기기 브라우저 안에만 저장되고 외부로 전송되지 않는다.
const DB_NAME = 'bunyang-crm';
const DB_VERSION = 2; // 2: 콜(calls) 저장소 추가
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('customers')) {
        const s = db.createObjectStore('customers', { keyPath: 'id' });
        s.createIndex('phoneDigits', 'phoneDigits');
        s.createIndex('nextDate', 'nextDate');
      }
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('calls')) db.createObjectStore('calls', { keyPath: 'id' });
    };
    req.onblocked = () => { /* 다른 탭이 옛 버전을 열고 있음: 그 탭이 닫히면 진행 */ };
    req.onsuccess = () => {
      const d = req.result;
      d.onversionchange = () => { d.close(); location.reload(); }; // 새 버전이 열리면 옛 탭은 닫고 새로고침
      resolve(d);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => run(store, 'readonly', (s) => s.get(id)),
  put: (store, obj) => run(store, 'readwrite', (s) => s.put(obj)),
  del: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  putMany: (store, list) => run(store, 'readwrite', (s) => { list.forEach((o) => s.put(o)); }),
  byPhone: (digits) => run('customers', 'readonly', (s) => s.index('phoneDigits').getAll(digits)),
};

// ---- 설정 (단일 문서) ----
export const DEFAULT_SETTINGS = {
  key: 'app',
  agentName: '',
  agentPhone: '',
  sites: [], // [{ name, address }]
  defaultAddress: '',
  cycles: { S: 2, A: 3, B: 7, C: 14, 계약: 30, 보류: 30 },
  theme: 'system', // system | light | dark
  seeded: false,
  lastBackup: null,
  // 팀 운영
  mode: '', // '' 미설정 | solo 혼자 | lead 팀장 | staff 직원
  staff: [], // (팀장) [{ id, name, phone }]
  staffSync: {}, // (팀장) { staffId: { reportAt, importedAt, assignAt, count } }
  me: null, // (직원) { id, name }
  leadName: '', // (직원) 팀장 이름
  lastReportAt: null, // (직원) 마지막 보고 파일 생성 시각
  lastAssignAt: null, // (직원) 마지막 배정 파일 불러온 시각
  callKinds: ['회사콜', '광고콜', '현수막콜', '지인소개', '기타'], // 콜 종류 (설정에서 수정)
};

export async function getSettings() {
  const s = await db.get('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...(s || {}), cycles: { ...DEFAULT_SETTINGS.cycles, ...((s && s.cycles) || {}) } };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, key: 'app' };
  await db.put('settings', next);
  return next;
}

// 저장공간 영구 보존 요청 (브라우저가 공간 부족 시 데이터를 지우지 않도록)
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* 지원 안 함 */ }
  return false;
}
