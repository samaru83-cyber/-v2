// 문자: 템플릿 관리 + 고객별 문자 생성(변수 자동 채움)
import { getSettings } from '../db.js';
import { listTemplates, saveTemplate, deleteTemplate, listCustomers, addHistory, getCustomer, TEMPLATE_CATEGORIES } from '../store.js';
import { esc, fillTemplate, smsLink, copyText, digitsOnly, TEMPLATE_VARS, debounce, today, addDays } from '../utils.js';
import { icon, go, toast, openSheet, confirmSheet, doneSheet, gradeBadge } from '../ui.js';
import { visibleCustomers } from '../team.js';

const missingVars = (text) => [...new Set(text.match(/\{[^{}]+\}/g) || [])].filter((v) => TEMPLATE_VARS.includes(v));

export async function render(el, ctx) {
  if (ctx.name === 'tpl') return renderEditor(el, ctx);
  const [tpls, allCustomers, s] = await Promise.all([listTemplates(), listCustomers(), getSettings()]);
  const customers = visibleCustomers(allCustomers, s);
  let cat = '';
  try { cat = sessionStorage.getItem('tplCat') || ''; } catch (e) { /* 무시 */ }

  const needSetup = !s.agentName || !s.agentPhone;
  el.innerHTML = `
    <div class="page-head"><h1>문자</h1></div>
    ${needSetup ? `<a class="card" href="#/settings" style="display:flex;gap:10px;align-items:center;color:var(--warn);background:var(--warn-soft);border-color:transparent;font-weight:600;font-size:14px">${icon('settings', 'sm')} 설정에서 상담사 이름·연락처·견본주택 주소를 입력하면 문자에 자동으로 들어갑니다</a>` : ''}
    <div class="card">
      <h3>고객에게 보내기</h3>
      <div class="search" style="margin-bottom:0">${icon('search')}<input id="cq" type="search" placeholder="고객 이름 또는 번호" autocomplete="off"></div>
      <div id="cres" style="margin-top:8px"></div>
    </div>
    <div class="section-title" style="margin-top:6px">템플릿 <span class="cnt">${tpls.length}</span></div>
    <div class="chips"><button class="chip ${cat === '' ? 'on' : ''}" data-cat="">전체</button><button class="chip ${cat === '★' ? 'on' : ''}" data-cat="★">★ 즐겨찾기</button>
      ${TEMPLATE_CATEGORIES.filter((c) => tpls.some((t) => t.category === c)).map((c) => `<button class="chip ${cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="tlist"></div>
    <a class="btn btn-soft btn-block" href="#/tpl/new" style="margin-top:4px">${icon('plus')} 템플릿 추가</a>`;

  const drawTpls = () => {
    const list = tpls.filter((t) => !cat || (cat === '★' ? t.favorite : t.category === cat));
    el.querySelector('#tlist').innerHTML = list.map((t) => `
      <div class="tpl">
        <button class="star ${t.favorite ? 'on' : ''}" data-star="${t.id}" aria-label="즐겨찾기">${icon('star')}</button>
        <div class="body" data-edit="${t.id}">
          <div class="cat">${esc(t.category)}</div><div class="ttl">${esc(t.title)}</div>
          <div class="snip">${esc(t.body)}</div>
        </div>
      </div>`).join('') || '<div class="empty" style="padding:20px">템플릿이 없습니다.</div>';
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => go(`#/tpl/${b.dataset.edit}`); });
    el.querySelectorAll('[data-star]').forEach((b) => {
      b.onclick = async () => {
        const t = tpls.find((x) => x.id === b.dataset.star);
        t.favorite = !t.favorite; await saveTemplate(t);
        b.classList.toggle('on', t.favorite);
      };
    });
  };
  el.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => {
      cat = b.dataset.cat;
      try { sessionStorage.setItem('tplCat', cat); } catch (e) { /* 무시 */ }
      el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      drawTpls();
    };
  });
  drawTpls();

  // 고객 검색 → 문자 생성
  const cres = el.querySelector('#cres');
  const drawCust = () => {
    const q = el.querySelector('#cq').value.trim().toLowerCase();
    const qd = digitsOnly(q);
    if (!q) {
      // 검색 전엔 오늘·기한 지남 고객을 바로가기로
      const t = today();
      const due = customers.filter((c) => c.nextDate && c.nextDate <= t).slice(0, 5);
      cres.innerHTML = due.length ? `<div style="font-size:13px;color:var(--text-2);margin:4px 2px 6px">오늘 관리 대상</div>` + due.map(custRow).join('') : '';
    } else {
      const list = customers.filter((c) => c.name.toLowerCase().includes(q) || (qd.length >= 3 && c.phoneDigits.includes(qd))).slice(0, 8);
      cres.innerHTML = list.map(custRow).join('') || '<div style="color:var(--text-3);font-size:14px;padding:6px 2px">일치하는 고객이 없습니다</div>';
    }
    cres.querySelectorAll('[data-cid]').forEach((r) => {
      r.onclick = async () => composeSheet(await getCustomer(r.dataset.cid), ctx.rerender);
    });
  };
  el.querySelector('#cq').addEventListener('input', debounce(drawCust, 120));
  drawCust();
}

const custRow = (c) => `<div class="row" data-cid="${c.id}" style="margin-bottom:6px;padding:10px 12px">
  <div class="body"><div class="name">${esc(c.name)} ${gradeBadge(c.grade)}</div><div class="meta">${esc(c.phone)} · ${esc(c.site || '')}</div></div>
  ${icon('send', 'sm')}</div>`;

// ---- 템플릿 편집 ----
async function renderEditor(el, ctx) {
  const id = ctx.params[0];
  const isNew = !id || id === 'new';
  const tpls = await listTemplates();
  const t = isNew ? { category: TEMPLATE_CATEGORIES[0], title: '', body: '', favorite: false } : tpls.find((x) => x.id === id);
  if (!t) { go('#/sms'); return; }
  const s = await getSettings();
  const sample = (await listCustomers())[0] || { name: '홍길동', site: s.sites[0]?.name || '○○현장', unitType: '84A', visitDate: addDays(today(), 1) };

  el.innerHTML = `
    <div class="page-head">
      <button class="icon-btn back" id="back" aria-label="뒤로">${icon('left')}</button>
      <h1>${isNew ? '템플릿 추가' : '템플릿 수정'}</h1>
      <button class="star ${t.favorite ? 'on' : ''}" id="fav" aria-label="즐겨찾기">${icon('star')}</button>
    </div>
    <div class="card">
      <div class="field"><label>카테고리</label><select id="cat">${TEMPLATE_CATEGORIES.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>템플릿 이름</label><input id="title" value="${esc(t.title)}" placeholder="예: 주말 방문 감사"></div>
      <div class="field"><label>내용</label>
        <div class="chips wrap">${TEMPLATE_VARS.map((v) => `<button type="button" class="chip var-chip" data-var="${esc(v)}">${esc(v)}</button>`).join('')}</div>
        <textarea id="body" style="min-height:200px" placeholder="변수 버튼을 누르면 커서 위치에 들어갑니다">${esc(t.body)}</textarea></div>
    </div>
    <div class="card">
      <h3>미리보기 <span style="font-weight:500;color:var(--text-2);font-size:13px">(${esc(sample.name)} 고객 기준)</span></h3>
      <div id="pv" style="white-space:pre-wrap;font-size:15px;line-height:1.6;color:var(--text-2)"></div>
    </div>
    <button class="btn btn-primary btn-block" id="save" style="min-height:54px">${icon('check')} 저장</button>
    ${isNew ? '' : `<button class="btn btn-block btn-danger" id="del" style="margin-top:8px">${icon('trash', 'sm')} 삭제</button>`}`;

  const body = el.querySelector('#body');
  const pv = el.querySelector('#pv');
  const draw = () => {
    pv.innerHTML = esc(fillTemplate(body.value, sample, s)).replace(/\{[^{}]+\}/g, (m) => `<span class="miss" style="background:var(--warn-soft);color:var(--warn)">${m}</span>`) || '<span style="color:var(--text-3)">내용을 입력하세요</span>';
  };
  body.addEventListener('input', draw);
  draw();
  let fav = !!t.favorite;
  el.querySelector('#fav').onclick = (e) => { fav = !fav; e.currentTarget.classList.toggle('on', fav); };
  el.querySelectorAll('[data-var]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.var, st = body.selectionStart ?? body.value.length, en = body.selectionEnd ?? st;
      body.value = body.value.slice(0, st) + v + body.value.slice(en);
      body.focus(); body.setSelectionRange(st + v.length, st + v.length); draw();
    };
  });
  el.querySelector('#back').onclick = () => go('#/sms');
  el.querySelector('#save').onclick = async () => {
    const title = el.querySelector('#title').value.trim();
    if (!title || !body.value.trim()) { toast('이름과 내용을 입력하세요'); return; }
    await saveTemplate({ ...t, category: el.querySelector('#cat').value, title, body: body.value, favorite: fav });
    toast('템플릿을 저장했습니다');
    go('#/sms');
  };
  const del = el.querySelector('#del');
  if (del) del.onclick = async () => {
    if (await confirmSheet({ title: `'${t.title}' 템플릿을 삭제할까요?`, ok: '삭제', danger: true })) { await deleteTemplate(t.id); toast('삭제했습니다'); go('#/sms'); }
  };
}

// ---- 문자 생성 시트 (고객 상세 / 문자 탭에서 호출) ----
export async function composeSheet(c, onChange) {
  if (!c) return;
  const [tpls, s] = await Promise.all([listTemplates(), getSettings()]);
  // 상황에 맞는 템플릿 먼저 추천: 내일 방문 → 리마인드, 계약 → 계약 축하
  const pick = (cat) => tpls.find((t) => t.category === cat);
  const tm = addDays(today(), 1);
  let cur = (c.visitDate === tm && pick('방문 전날 리마인드')) || (c.grade === '계약' && pick('계약 축하')) || tpls[0];
  let logged = false;
  const { el, close } = openSheet(`
    <h2>${esc(c.name)}님께 문자</h2>
    <p class="sheet-sub">${esc(c.phone)} · 템플릿을 고르면 내용이 자동으로 채워집니다</p>
    <div class="chips" id="tchips">${tpls.map((t) => `<button class="chip ${cur && t.id === cur.id ? 'on' : ''}" data-t="${t.id}">${t.favorite ? '★ ' : ''}${esc(t.title)}</button>`).join('')}</div>
    <textarea class="preview" id="msg"></textarea>
    <p class="miss-note hidden" id="miss"></p>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" id="copy">${icon('copy')} 복사</button>
      <button class="btn btn-primary" id="open">${icon('send')} 문자앱 열기</button>
    </div>`);
  const msg = el.querySelector('#msg');
  const missEl = el.querySelector('#miss');
  const showMissing = () => {
    const miss = missingVars(msg.value);
    missEl.textContent = miss.length ? `채워지지 않은 항목: ${miss.join(' ')} — 고객 정보나 설정에서 입력하거나 직접 고쳐 주세요.` : '';
    missEl.classList.toggle('hidden', !miss.length);
  };
  const apply = () => { msg.value = cur ? fillTemplate(cur.body, c, s) : ''; showMissing(); };
  msg.addEventListener('input', () => { msg.dataset.dirty = '1'; showMissing(); });
  el.querySelectorAll('[data-t]').forEach((b) => {
    b.onclick = () => {
      if (msg.dataset.dirty && !confirm('수정한 내용이 사라집니다. 템플릿을 바꿀까요?')) return;
      cur = tpls.find((t) => t.id === b.dataset.t);
      el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
      delete msg.dataset.dirty; apply();
    };
  });
  apply();
  const onChip = el.querySelector('#tchips .chip.on');
  if (onChip) setTimeout(() => onChip.scrollIntoView({ inline: 'center', block: 'nearest' }), 280);

  const log = async () => {
    if (logged) return;
    logged = true;
    await addHistory(c.id, { kind: '문자', text: `문자발송: ${cur ? cur.title : '직접 작성'}` }, { next: 'keep' });
    onChange && onChange();
  };
  const afterToast = (m) => toast(m, { label: '관리 완료', run: () => doneSheet(c.id, onChange) });

  el.querySelector('#copy').onclick = async () => {
    if (await copyText(msg.value)) { await log(); afterToast('복사했습니다 · 히스토리에 기록됨'); }
    else toast('복사에 실패했습니다. 길게 눌러 직접 복사하세요');
  };
  el.querySelector('#open').onclick = async () => {
    const link = smsLink(c.phone, msg.value);
    await log();
    close();
    afterToast('문자앱을 열었습니다 · 히스토리에 기록됨');
    location.href = link;
  };
}
