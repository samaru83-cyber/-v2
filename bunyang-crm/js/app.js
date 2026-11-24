// 앱 진입점: 초기화, 해시 라우터, 메뉴(모드별), 테마, 서비스워커
import { getSettings, requestPersist } from './db.js';
import { ensureDefaults } from './seed.js';
import { listCustomers } from './store.js';
import { bucketOf, esc } from './utils.js';
import { visibleCustomers } from './team.js';
import { listCalls, isStale } from './calls.js';

const routes = {
  setup: () => import('./views/setup.js'),
  home: () => import('./views/home.js'),
  team: () => import('./views/team.js'),
  sync: () => import('./views/sync.js'),
  customers: () => import('./views/customers.js'),
  c: () => import('./views/detail.js'),
  new: () => import('./views/form.js'),
  edit: () => import('./views/form.js'),
  calendar: () => import('./views/calendar.js'),
  sms: () => import('./views/sms.js'),
  tpl: () => import('./views/sms.js'),
  settings: () => import('./views/settings.js'),
  calls: () => import('./views/calls.js'),
};
const TAB_OF = { home: 'home', team: 'team', sync: 'sync', customers: 'customers', c: 'customers', new: 'customers', edit: 'customers', calendar: 'calendar', sms: 'sms', tpl: 'sms', settings: 'settings', calls: 'calls' };
const FAB_ON = ['home', 'team', 'customers', 'calendar'];

// 모드별 메뉴. mobile:false = PC 사이드바에만 표시
const NAV = {
  lead: [
    { tab: 'team', label: '팀 현황', icon: 'team', badge: true },
    { tab: 'customers', label: '고객', icon: 'users' },
    { tab: 'calls', label: '콜 배분', short: '콜', icon: 'phone', badge: 'calls' },
    { tab: 'calendar', label: '캘린더', icon: 'calendar' },
    { tab: 'sync', label: '파일 주고받기', short: '파일', icon: 'swap' },
    { tab: 'sms', label: '문자', icon: 'message', mobile: false },
    { tab: 'settings', label: '설정', icon: 'settings' },
  ],
  staff: [
    { tab: 'home', label: '홈', icon: 'home', badge: true },
    { tab: 'customers', label: '고객', icon: 'users' },
    { tab: 'calls', label: '받은 콜', short: '콜', icon: 'phone', badge: 'calls' },
    { tab: 'calendar', label: '캘린더', icon: 'calendar' },
    { tab: 'sms', label: '문자', icon: 'message' },
    { tab: 'sync', label: '팀장에게 보고', icon: 'swap', mobile: false },
    { tab: 'settings', label: '설정', icon: 'settings' },
  ],
  solo: [
    { tab: 'home', label: '홈', icon: 'home', badge: true },
    { tab: 'customers', label: '고객', icon: 'users' },
    { tab: 'calls', label: '콜 기록', short: '콜', icon: 'phone' },
    { tab: 'calendar', label: '캘린더', icon: 'calendar' },
    { tab: 'sms', label: '문자', icon: 'message' },
    { tab: 'settings', label: '설정', icon: 'settings' },
  ],
};
const ROLE = { lead: '팀장', staff: '직원', solo: '개인' };

const view = document.getElementById('view');
const fab = document.getElementById('fab');
const nav = document.getElementById('tabbar');
let renderSeq = 0;
const scrollMap = {};
let lastHash = null;
let navMode = null;

export async function buildNav(force = false) {
  const s = await getSettings();
  const mode = s.mode || 'solo';
  if (!force && navMode === mode + (s.agentName || '') + (s.me?.name || '')) return;
  navMode = mode + (s.agentName || '') + (s.me?.name || '');
  const who = mode === 'staff' ? s.me?.name : s.agentName;
  nav.innerHTML = `
    <div class="brand"><b>분양 고객관리</b><span>${ROLE[mode]}${who ? ` · ${esc(who)}` : ''}</span></div>
    ${NAV[mode].map((n) => `<a href="#/${n.tab}" data-tab="${n.tab}" class="${n.mobile === false ? 'desk-only' : ''}">
      <svg class="icon"><use href="#i-${n.icon}"/></svg><span class="lbl-full">${n.label}</span><span class="lbl-short">${n.short || n.label}</span>
      ${n.badge ? `<span class="nb hidden" id="nb-${n.badge === true ? 'home' : n.badge}"></span>` : ''}</a>`).join('')}`;
}

async function route() {
  if (lastHash !== null) scrollMap[lastHash] = window.scrollY;
  const s = await getSettings();
  let [name = '', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  if (!s.mode && name !== 'setup') { location.replace('#/setup'); return; }
  if (!name || !routes[name]) name = s.mode === 'lead' ? 'team' : 'home';
  if (name === 'home' && s.mode === 'lead') name = 'team';
  const seq = ++renderSeq;
  const mod = await routes[name]();
  if (seq !== renderSeq) return;
  document.body.classList.toggle('no-nav', name === 'setup');
  await buildNav();
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TAB_OF[name]));
  fab.classList.toggle('hidden', !FAB_ON.includes(name));
  const ctx = { name, params: params.map(decodeURIComponent) };
  ctx.rerender = async () => {
    const y = window.scrollY;
    await mod.render(view, ctx);
    window.scrollTo(0, y);
    updateBadge();
  };
  await mod.render(view, ctx);
  window.scrollTo(0, scrollMap[location.hash] || 0);
  lastHash = location.hash;
  updateBadge();
}

/** 홈 메뉴와 앱 아이콘에 '오늘+기한 지남' 관리 수 표시 */
export async function updateBadge() {
  const s = await getSettings();
  const list = visibleCustomers(await listCustomers(), s);
  const n = list.filter((c) => ['overdue', 'today'].includes(bucketOf(c.nextDate))).length;
  const nb = document.getElementById('nb-home');
  if (nb) { nb.textContent = n > 99 ? '99+' : n; nb.classList.toggle('hidden', n === 0); }
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { /* 미지원 */ }
  // 콜 메뉴 숫자: 직원 = 처리 전 콜, 팀장 = 하루 넘게 결과 없는 콜
  const nc = document.getElementById('nb-calls');
  if (nc) {
    const calls = await listCalls();
    const k = s.mode === 'staff'
      ? calls.filter((c) => (!c.owner || c.owner === s.me?.id) && (!c.result || c.result === '부재')).length
      : calls.filter(isStale).length;
    nc.textContent = k > 99 ? '99+' : k; nc.classList.toggle('hidden', k === 0);
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#181b21' : '#ffffff';
}

// Android Chrome 설치 프롬프트를 잡아뒀다가 설정 화면 [홈 화면에 설치] 버튼에서 사용
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });

async function init() {
  await ensureDefaults();
  const s = await getSettings();
  applyTheme(s.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => applyTheme((await getSettings()).theme));
  requestPersist();
  fab.onclick = () => { location.hash = '#/new'; };
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
