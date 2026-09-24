'use strict';
const API_URL = 'https://script.google.com/macros/s/AKfycbwvnP6CVA2zAbAmvniq6_uQpA2DRdC9Q4d_4_PAWuZjwldr-31cQ5LlMnHBPhQiA5rdpA/exec';
const MAX_NB = 35;
const STORE_KEY = 'reserva_nb_v2';
const NOMES_KEY = 'reserva_nb_nomes';
const CARRINHOS = ['Carrinho 1', 'Carrinho 2'];

let _cache = null, _cacheTime = 0;
const CACHE_TTL = 30_000;
let _apiOnline = null;
let _apiErro = '';

async function fetchAll(force = false) {
  if (!force && _cache !== null && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  if (!API_URL) {
    _autoReturnLocal();
    _cache = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    _cacheTime = Date.now();
    _apiOnline = false;
    _apiErro = 'API_URL não configurada — modo local.';
    return _cache;
  }
  try {
    const res = await fetch(`${API_URL}?action=getAll`);
    const data = await res.json();
    if (!Array.isArray(data)) {
      const msg = data.error || JSON.stringify(data);
      console.error('[API] fetchAll — resposta inválida:', msg);
      _apiOnline = false;
      _apiErro = 'Planilha retornou erro: ' + msg;
      if (_cache === null) {
        _autoReturnLocal();
        _cache = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      }
      _cacheTime = Date.now();
      return _cache;
    }
    _cache = data;
    _cacheTime = Date.now();
    _apiOnline = true;
    _apiErro = '';
    localStorage.setItem(STORE_KEY, JSON.stringify(_cache));
    return _cache;
  } catch (err) {
    console.error('[API] fetchAll — falha de rede ou CORS:', err.message ?? err);
    _apiOnline = false;
    _apiErro = 'Falha de conexão com a planilha. Verifique se o Code.gs está implantado.';
    if (_cache === null) {
      _autoReturnLocal();
      _cache = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    }
    _cacheTime = Date.now();
    return _cache;
  }
}

function getAll() {
  return _cache ?? JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
}

async function saveReserva(reserva) {
  if (!API_URL) {
    const list = getAll();
    list.push(reserva);
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    _cache = list;
    _cacheTime = Date.now();
    return { ok: true };
  }
  let data;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'criar', reserva }),
    });
    data = await res.json();
    console.log('[API] saveReserva resposta:', data);
  } catch (err) {
    console.error('[API] saveReserva — falha de rede ou CORS:', err.message ?? err);
    throw err;
  }
  if (data.error) {
    console.error('[API] saveReserva — erro do servidor:', data.error);
    return data;
  }
  const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  list.push(reserva);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  _cache = list;
  _cacheTime = Date.now();
  _apiOnline = true;
  return data;
}

function _autoReturnLocal() {
  const now = new Date();
  const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  let changed = false;
  list.forEach(r => {
    if (r.status !== 'ativa') return;
    const allExpired = r.slots.every(s => parseLocal(s.devolucao) < now);
    if (allExpired) {
      r.status = 'devolvida';
      r.devolvidoEm = now.toISOString();
      changed = true;
    }
  });
  if (changed) localStorage.setItem(STORE_KEY, JSON.stringify(list));
}

function overlaps(slotA, slotB) {
  return parseLocal(slotA.retirada) < parseLocal(slotB.devolucao) &&
         parseLocal(slotB.retirada) < parseLocal(slotA.devolucao);
}

function getDisp(carrinho, slot) {
  const usado = getAll()
    .filter(r => r.status === 'ativa' && r.unidade === carrinho)
    .filter(r => r.slots.some(s => overlaps(s, slot)))
    .reduce((n, r) => n + r.quantidade, 0);
  return MAX_NB - usado;
}

function peakUsage(carrinho, dateISO) {
  const dayStart = parseLocal(dateISO + 'T00:00');
  const dayEnd = parseLocal(dateISO + 'T23:59');
  const events = [];
  getAll()
    .filter(r => r.status === 'ativa' && r.unidade === carrinho)
    .forEach(r => {
      r.slots.forEach(s => {
        const sStart = parseLocal(s.retirada);
        const sEnd = parseLocal(s.devolucao);
        if (sStart < dayEnd && sEnd > dayStart) {
          events.push({ t: sStart.getTime(), q: r.quantidade, type: 1 });
          events.push({ t: sEnd.getTime(), q: r.quantidade, type: -1 });
        }
      });
    });
  if (!events.length) return 0;
  events.sort((a, b) => a.t - b.t || a.type - b.type);
  let current = 0, peak = 0;
  events.forEach(e => {
    current += e.q * e.type;
    if (e.type === 1) peak = Math.max(peak, current);
  });
  return peak;
}

function findNearbyDates(carrinho, slot, quantidade, maxResults = 3) {
  const retStart = parseLocal(slot.retirada);
  const devEnd = parseLocal(slot.devolucao);
  const duration = devEnd - retStart;
  const suggestions = [];
  for (let i = 1; i <= 30 && suggestions.length < maxResults; i++) {
    const candidate = new Date(retStart);
    candidate.setDate(candidate.getDate() + i);
    if (candidate.getDay() === 0 || candidate.getDay() === 6) continue;
    const candRet = new Date(candidate);
    const candDev = new Date(candidate.getTime() + duration);
    if (candDev.getDate() !== candRet.getDate() && devEnd.getDate() === retStart.getDate()) continue;
    const candSlot = { retirada: toISOLocal(candRet), devolucao: toISOLocal(candDev) };
    const disp = getDisp(carrinho, candSlot);
    if (disp >= quantidade) {
      suggestions.push({
        slot: candSlot,
        disp,
        label: candRet.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }),
        horas: `${fmtTime(candSlot.retirada)} – ${fmtTime(candSlot.devolucao)}`,
      });
    }
  }
  return suggestions;
}

function parseLocal(str) {
  const [d, t = '00:00'] = String(str).split('T');
  const [y, mo, dy] = d.split('-').map(Number);
  const [h, mi = 0] = t.split(':').map(Number);
  return new Date(y, mo - 1, dy, h, mi, 0);
}

function toISOLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayISO() { return toISOLocal(new Date()).slice(0, 10); }

function pad(n) { return String(n).padStart(2, '0'); }

function fmtTime(iso) {
  const d = parseLocal(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateShort(iso) {
  const d = parseLocal(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
}

function fmtDatetime(iso) {
  return `${fmtDateShort(iso)} ${fmtTime(iso)}h`;
}

function fmtDateTimeFull(isoZ) {
  if (!isoZ) return '';
  const d = new Date(isoZ);
  if (isNaN(d)) return String(isoZ);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function saveNome(nome) {
  const nomes = JSON.parse(localStorage.getItem(NOMES_KEY) || '[]');
  const normalizado = nome.trim();
  if (normalizado && !nomes.includes(normalizado)) {
    nomes.push(normalizado);
    localStorage.setItem(NOMES_KEY, JSON.stringify(nomes));
  }
  _atualizarDatalist();
}

function _atualizarDatalist() {
  const nomes = JSON.parse(localStorage.getItem(NOMES_KEY) || '[]');
  const datalist = document.getElementById('nomes-list');
  if (!datalist) return;
  datalist.innerHTML = nomes
    .map(n => `<option value="${n.replace(/"/g, '&quot;')}">`)
    .join('');
}

function maskName(nome) {
  return nome.trim().split(/\s+/).map((p, i) => {
    const keep = i === 0 ? 2 : 1;
    return p.slice(0, keep) + '*'.repeat(Math.max(1, p.length - keep));
  }).join(' ');
}

function maskCPF(cpf) {
  const s = String(cpf).replace(/\D/g, '');
  if (s.length < 11) return s;
  return s.slice(0, 3) + '.***.***-' + s.slice(-2);
}

function validarCPF(cpf) {
  const s = String(cpf).replace(/\D/g, '');
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(s[i]) * (10 - i);
  let d1 = 11 - (soma % 11); if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(s[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(s[i]) * (11 - i);
  let d2 = 11 - (soma % 11); if (d2 >= 10) d2 = 0;
  return d2 === parseInt(s[10]);
}

function getInitials(nome) {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

let _toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className = `toast ${type ? 'toast-' + type : ''} show`;
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3400);
}

function fieldError(wrapId, errId, msg) {
  const wrap = document.getElementById(wrapId);
  const err = document.getElementById(errId);
  if (wrap) wrap.classList.add('has-error');
  if (err && msg) err.textContent = msg;
}

function fieldClear(wrapId) {
  document.getElementById(wrapId)?.classList.remove('has-error');
}

function clearAllErrors() {
  ['wrap-nome','wrap-cpf','wrap-unidade','wrap-quantidade','wrap-slots']
    .forEach(id => fieldClear(id));
  document.querySelectorAll('.slot-row').forEach(r => r.classList.remove('slot-error'));
}

let _slotCounter = 0;
function addSlotRow(opts = {}) {
  _slotCounter++;
  const today = todayISO();
  const retDate = opts.retDate || today;
  const retHora = opts.retHora || '08:00';
  const devDate = opts.devDate || today;
  const devHora = opts.devHora || '17:00';
  const row = document.createElement('div');
  row.className = 'slot-row';
  row.dataset.id = _slotCounter;
  row.innerHTML = `
    <div class="slot-fields">
      <div class="slot-group">
        <span class="slot-lbl">Retirada</span>
        <div class="slot-dt">
          <input type="date" class="slot-data-ret" min="${today}" value="${retDate}" aria-label="Data de retirada">
          <input type="time" class="slot-hora-ret" min="08:00" max="23:00" value="${retHora}" aria-label="Hora de retirada">
        </div>
      </div>
      <div class="slot-sep">→</div>
      <div class="slot-group">
        <span class="slot-lbl">Devolução</span>
        <div class="slot-dt">
          <input type="date" class="slot-data-dev" min="${today}" value="${devDate}" aria-label="Data de devolução">
          <input type="time" class="slot-hora-dev" min="08:00" max="23:00" value="${devHora}" aria-label="Hora de devolução">
        </div>
      </div>
    </div>
    <button type="button" class="slot-remove" aria-label="Remover período">×</button>
  `;
  row.querySelector('.slot-remove').addEventListener('click', () => {
    row.remove();
    updateQtyHint();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    row.classList.remove('slot-error');
    updateQtyHint();
  }));
  document.getElementById('slot-list').appendChild(row);
  updateQtyHint();
}

function getSlotValues() {
  return Array.from(document.querySelectorAll('.slot-row')).map(row => {
    const dataRet = row.querySelector('.slot-data-ret').value;
    const horaRet = row.querySelector('.slot-hora-ret').value;
    const dataDev = row.querySelector('.slot-data-dev').value;
    const horaDev = row.querySelector('.slot-hora-dev').value;
    return {
      row,
      slot: (dataRet && horaRet && dataDev && horaDev)
        ? { retirada: `${dataRet}T${horaRet}`, devolucao: `${dataDev}T${horaDev}` }
        : null,
    };
  });
}

function updateQtyHint() {
  const hint = document.getElementById('qty-hint');
  const qtyInput = document.getElementById('quantidade');
  const carrinho = document.getElementById('unidade').value;
  const slots = getSlotValues().map(s => s.slot).filter(Boolean);
  if (_cache === null || !carrinho || slots.length === 0) {
    hint.textContent = 'Selecione o carrinho e adicione um período para ver disponibilidade';
    hint.className = 'qty-hint';
    return;
  }
  const minDisp = slots.reduce((min, s) => Math.min(min, getDisp(carrinho, s)), MAX_NB);
  const cur = parseInt(qtyInput.value) || 1;
  if (cur > minDisp && minDisp >= 0) qtyInput.value = Math.max(minDisp, 0);
  if (minDisp <= 0) {
    hint.textContent = 'Sem disponibilidade para o período selecionado';
    hint.className = 'qty-hint qty-none';
  } else if (minDisp < 10) {
    hint.textContent = `⚠ Restam apenas ${minDisp} de ${MAX_NB} notebooks`;
    hint.className = 'qty-hint qty-low';
  } else {
    hint.textContent = `Disponível: ${minDisp} de ${MAX_NB} notebooks`;
    hint.className = 'qty-hint qty-ok';
  }
}

function initReservar() {
  const qtyInput = document.getElementById('quantidade');
  document.getElementById('qty-minus').addEventListener('click', () => {
    const v = parseInt(qtyInput.value) || 1;
    if (v > 1) { qtyInput.value = v - 1; updateQtyHint(); }
  });
  document.getElementById('qty-plus').addEventListener('click', () => {
    const v = parseInt(qtyInput.value) || 1;
    const max = parseInt(qtyInput.max) || MAX_NB;
    if (v < max) { qtyInput.value = v + 1; updateQtyHint(); }
  });
  qtyInput.addEventListener('input', () => {
    let v = parseInt(qtyInput.value);
    if (isNaN(v) || v < 1) qtyInput.value = 1;
    updateQtyHint();
  });
  document.getElementById('unidade').addEventListener('change', updateQtyHint);
  document.getElementById('btn-add-slot').addEventListener('click', () => {
    fieldClear('wrap-slots');
    addSlotRow();
  });
  addSlotRow();
  document.getElementById('form-reserva').addEventListener('submit', handleSubmit);
  document.getElementById('btn-nova-reserva').addEventListener('click', () => {
    document.getElementById('form-section').hidden = false;
    document.getElementById('confirmacao').hidden = true;
    document.getElementById('suggestion-box').hidden = true;
    document.getElementById('form-reserva').reset();
    document.getElementById('slot-list').innerHTML = '';
    _slotCounter = 0;
    addSlotRow();
    updateQtyHint();
    clearAllErrors();
    resetRecorrente();
  });
  ['nome','cpf','unidade','quantidade'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => fieldClear(`wrap-${id}`));
    el.addEventListener('change', () => fieldClear(`wrap-${id}`));
  });
  initRecorrente();
}

const MAX_SLOTS_RECORRENTE = 60;
const _recDiasSelecionados = new Set();
function initRecorrente() {
  const panel = document.getElementById('recorrente-panel');
  document.getElementById('btn-toggle-recorrente').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !document.getElementById('rec-inicio').value) {
      document.getElementById('rec-inicio').value = todayISO();
      document.getElementById('rec-inicio').min = todayISO();
      document.getElementById('rec-fim').min = todayISO();
    }
  });
  document.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dow = btn.dataset.dow;
      btn.classList.toggle('active');
      if (_recDiasSelecionados.has(dow)) _recDiasSelecionados.delete(dow);
      else _recDiasSelecionados.add(dow);
    });
  });
  document.getElementById('btn-gerar-recorrente').addEventListener('click', gerarPeriodosRecorrentes);
}

function resetRecorrente() {
  document.getElementById('recorrente-panel').hidden = true;
  document.getElementById('rec-inicio').value = '';
  document.getElementById('rec-fim').value = '';
  document.getElementById('rec-hora-ret').value = '08:00';
  document.getElementById('rec-hora-dev').value = '17:00';
  document.getElementById('rec-hint').textContent = '';
  document.querySelectorAll('.weekday-btn.active').forEach(b => b.classList.remove('active'));
  _recDiasSelecionados.clear();
}

function gerarPeriodosRecorrentes() {
  const hint = document.getElementById('rec-hint');
  const inicio = document.getElementById('rec-inicio').value;
  const fim = document.getElementById('rec-fim').value;
  const horaRet = document.getElementById('rec-hora-ret').value;
  const horaDev = document.getElementById('rec-hora-dev').value;
  function avisar(msg) {
    hint.textContent = msg;
    hint.className = 'rec-hint rec-hint-error';
  }
  if (!inicio || !fim) return avisar('Informe a data início e a data fim.');
  if (!horaRet || !horaDev) return avisar('Informe a hora de retirada e de devolução.');
  if (horaRet >= horaDev) return avisar('A hora de devolução deve ser posterior à de retirada.');
  if (inicio > fim) return avisar('A data fim deve ser igual ou posterior à data início.');
  if (_recDiasSelecionados.size === 0) return avisar('Selecione ao menos um dia da semana.');
  const [y1, m1, d1] = inicio.split('-').map(Number);
  const [y2, m2, d2] = fim.split('-').map(Number);
  const cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  let count = 0;
  while (cur <= end && count < MAX_SLOTS_RECORRENTE) {
    if (_recDiasSelecionados.has(String(cur.getDay()))) {
      const dataISO = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      addSlotRow({ retDate: dataISO, retHora: horaRet, devDate: dataISO, devHora: horaDev });
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (count === 0) return avisar('Nenhuma data encontrada nesse intervalo para os dias escolhidos.');
  fieldClear('wrap-slots');
  hint.textContent = cur <= end
    ? `Limite de ${MAX_SLOTS_RECORRENTE} períodos atingido — ${count} adicionados. Gere o restante em outra reserva.`
    : `${count} período${count > 1 ? 's' : ''} adicionado${count > 1 ? 's' : ''} com sucesso.`;
  hint.className = 'rec-hint rec-hint-ok';
  document.getElementById('recorrente-panel').hidden = true;
  updateQtyHint();
}

async function handleSubmit(e) {
  e.preventDefault();
  clearAllErrors();
  document.getElementById('suggestion-box').hidden = true;
  const nome = document.getElementById('nome').value.trim();
  const cpf = document.getElementById('cpf').value.trim();
  const carrinho = document.getElementById('unidade').value;
  const quantidade = parseInt(document.getElementById('quantidade').value) || 0;
  const slotData = getSlotValues();
  let valid = true;
  if (!nome) {
    fieldError('wrap-nome', 'err-nome', 'Informe seu nome completo.');
    valid = false;
  }
  if (!cpf) {
    fieldError('wrap-cpf', 'err-cpf', 'Informe seu CPF.');
    valid = false;
  } else if (!validarCPF(cpf)) {
    fieldError('wrap-cpf', 'err-cpf', 'CPF inválido. Verifique os 11 dígitos.');
    valid = false;
  }
  if (!carrinho) {
    fieldError('wrap-unidade', 'err-unidade', 'Selecione o carrinho.');
    valid = false;
  }
  if (!quantidade || quantidade < 1) {
    fieldError('wrap-quantidade', 'err-quantidade', 'Quantidade inválida (mínimo 1).');
    valid = false;
  }
  if (slotData.length === 0) {
    fieldError('wrap-slots', 'err-slots', 'Adicione pelo menos um período de reserva.');
    valid = false;
  }
  slotData.filter(s => !s.slot).forEach(({ row }) => row.classList.add('slot-error'));
  if (slotData.some(s => !s.slot)) {
    fieldError('wrap-slots', 'err-slots', 'Preencha todos os campos de data e horário dos períodos.');
    valid = false;
  }
  slotData.filter(s => s.slot).forEach(({ row, slot }) => {
    if (parseLocal(slot.retirada) >= parseLocal(slot.devolucao)) {
      row.classList.add('slot-error');
      fieldError('wrap-slots', 'err-slots', 'A devolução deve ser posterior à retirada em cada período.');
      valid = false;
    }
  });
  if (!valid) {
    document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const slots = slotData.map(s => s.slot);
  await fetchAll();
  const conflicts = [];
  for (const slot of slots) {
    const disp = getDisp(carrinho, slot);
    if (disp < quantidade) conflicts.push({ slot, disp });
  }
  if (conflicts.length > 0) {
    const first = conflicts[0];
    const suggestions = findNearbyDates(carrinho, first.slot, quantidade);
    showSuggestions(first.slot, first.disp, suggestions, quantidade);
    toast('Sem disponibilidade para um ou mais períodos selecionados.', 'error');
    return;
  }
  const btn = document.getElementById('btn-reservar');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-btn"></span> Salvando…`;
  const reserva = {
    id: genId(),
    nome,
    cpf,
    unidade: carrinho,
    quantidade,
    slots,
    status: 'ativa',
    criadoEm: new Date().toISOString(),
  };
  try {
    const res = await saveReserva(reserva);
    if (res.error) {
      toast(res.error, 'error');
      btn.disabled = false;
      btn.innerHTML = _btnReservarLabel();
      return;
    }
    showConfirmation(reserva);
  } catch {
    toast('Erro ao salvar. Tente novamente.', 'error');
    btn.disabled = false;
    btn.innerHTML = _btnReservarLabel();
  }
}

function _btnReservarLabel() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Confirmar Reserva`;
}

function showSuggestions(conflictSlot, disp, suggestions, quantidade) {
  const box = document.getElementById('suggestion-box');
  const header = `<div class="suggestion-title">
    ⚠ Sem disponibilidade: ${fmtDatetime(conflictSlot.retirada)} – ${fmtTime(conflictSlot.devolucao)}h
    (${Math.max(0, disp)} de ${MAX_NB} disponíveis)
  </div>`;
  const body = suggestions.length === 0
    ? '<p style="font-size:12px;color:var(--orange-dark)">Nenhuma data próxima disponível encontrada.</p>'
    : `<div style="font-size:11px;color:var(--orange-dark);font-weight:700;margin-bottom:8px">
        Próximas datas disponíveis com o mesmo horário:
      </div>
      ${suggestions.map((s, i) => `
        <div class="suggestion-item">
          <div class="suggestion-info">
            <strong>${s.label}</strong>
            <small>${s.horas} · ${s.disp} notebooks livres</small>
          </div>
          <button class="btn-use-suggestion" data-idx="${i}">Usar esta data</button>
        </div>
      `).join('')}`;
  box.innerHTML = header + body;
  box.hidden = false;
  box.querySelectorAll('.btn-use-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = suggestions[parseInt(btn.dataset.idx)];
      addSlotRow({
        retDate: s.slot.retirada.slice(0, 10),
        retHora: fmtTime(s.slot.retirada),
        devDate: s.slot.devolucao.slice(0, 10),
        devHora: fmtTime(s.slot.devolucao),
      });
      box.hidden = true;
      toast(`Período ${s.label} adicionado.`, 'success');
    });
  });
}

function showConfirmation(reserva) {
  document.getElementById('form-section').hidden = true;
  document.getElementById('confirmacao').hidden = false;
  document.getElementById('conf-avatar').textContent = getInitials(reserva.nome);
  document.getElementById('conf-nome').textContent = maskName(reserva.nome);
  document.getElementById('conf-cpf').textContent = maskCPF(reserva.cpf);
  document.getElementById('conf-unidade').textContent = reserva.unidade;
  document.getElementById('conf-quantidade').textContent =
    `${reserva.quantidade} notebook${reserva.quantidade > 1 ? 's' : ''}`;
  document.getElementById('conf-slots').innerHTML = reserva.slots.map((s, i) => `
    <div class="conf-slot-row">
      <div class="slot-row-label">Período ${i + 1}</div>
      <div class="slot-row-val">
        ${fmtDatetime(s.retirada)} → ${fmtDatetime(s.devolucao)}
      </div>
    </div>
  `).join('');
  document.getElementById('btn-reservar').disabled = false;
  document.getElementById('btn-reservar').innerHTML = _btnReservarLabel();
  saveNome(reserva.nome);
  toast('Reserva realizada com sucesso!', 'success');
  renderSituacao();
}

function initConsultar() {
  const now = new Date();
  document.getElementById('cons-mes').value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  document.getElementById('btn-consultar').addEventListener('click', renderConsulta);
}

async function renderConsulta() {
  const btn = document.getElementById('btn-consultar');
  btn.disabled = true;
  await fetchAll();
  const carrinho = document.getElementById('cons-unidade').value;
  const mes = document.getElementById('cons-mes').value;
  const horaRet = document.getElementById('cons-hora-ret').value;
  const horaDev = document.getElementById('cons-hora-dev').value;
  if (!mes) {
    toast('Selecione um mês de referência.', 'warn');
    btn.disabled = false;
    return;
  }
  const [year, month] = mes.split('-').map(Number);
  const weekdays = getWeekdays(year, month);
  const hasFilter = horaRet && horaDev;
  const timeLabel = hasFilter ? ` · ${horaRet}–${horaDev}` : '';
  const container = document.getElementById('consulta-resultado');
  function avail(c, d) {
    if (hasFilter) return getDisp(c, { retirada: `${d}T${horaRet}`, devolucao: `${d}T${horaDev}` });
    return MAX_NB - peakUsage(c, d);
  }
  function badgeCls(n) {
    return n <= 0 ? 'avail-none' : n < 10 ? 'avail-low' : n < 20 ? 'avail-mid' : 'avail-ok';
  }
  function dayNameShort(d) {
    const [y, mo, dy] = d.split('-').map(Number);
    return new Date(y, mo - 1, dy).toLocaleDateString('pt-BR', { weekday: 'short' });
  }
  function reservasDoDia(c, d) {
    const [y, mo, dy] = d.split('-').map(Number);
    const dS = new Date(y, mo-1, dy, 0, 0);
    const dE = new Date(y, mo-1, dy, 23, 59, 59);
    return getAll().filter(r =>
      r.status === 'ativa' && r.unidade === c &&
      r.slots.some(s => parseLocal(s.retirada) < dE && parseLocal(s.devolucao) > dS)
    );
  }
  function slotsNoDia(r, d) {
    const [y, mo, dy] = d.split('-').map(Number);
    const dS = new Date(y, mo-1, dy, 0, 0);
    const dE = new Date(y, mo-1, dy, 23, 59, 59);
    return r.slots.filter(s => parseLocal(s.retirada) < dE && parseLocal(s.devolucao) > dS);
  }
  const legend = `<div class="avail-legend" style="margin-top:12px">
    <span class="avail-badge avail-ok">20+</span> Alta&nbsp;&nbsp;
    <span class="avail-badge avail-mid">10+</span> Média&nbsp;&nbsp;
    <span class="avail-badge avail-low">1+</span> Baixa&nbsp;&nbsp;
    <span class="avail-badge avail-none">0</span> Esgotado
  </div>`;
  if (carrinho) {
    const rows = weekdays.map(d => {
      const [,, dy] = d.split('-');
      const disp = Math.max(0, avail(carrinho, d));
      const cls = badgeCls(disp);
      const res = reservasDoDia(carrinho, d);
      const slotsHtml = res.length === 0
        ? '<span style="color:var(--gray-40)">—</span>'
        : res.flatMap(r =>
            slotsNoDia(r, d).map(s =>
              `<span class="slot-time-badge">${fmtTime(s.retirada)}–${fmtTime(s.devolucao)} <strong>${r.quantidade}nb</strong></span>`
            )
          ).join('');
      return `<tr>
        <td class="avail-date"><strong>${dy}/${pad(month)}/${String(year).slice(-2)}</strong><small>${dayNameShort(d)}.</small></td>
        <td><span class="avail-badge ${cls}">${disp}/35</span></td>
        <td class="avail-slots-cell">${slotsHtml}</td>
      </tr>`;
    }).join('');
    container.innerHTML = `<div class="search-card" style="padding-top:20px">
      <div class="search-eyebrow"><span class="eyebrow-bar"></span><span>${carrinho}${timeLabel}</span></div>
      <div class="avail-table-wrap">
        <table class="avail-table">
          <thead><tr><th>Data</th><th>Disponível</th><th>Horários reservados</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>${legend}
    </div>`;
  } else {
    const rows = weekdays.map(d => {
      const [,, dy] = d.split('-');
      const cells = CARRINHOS.map(c => {
        const disp = Math.max(0, avail(c, d));
        return `<td><span class="avail-badge ${badgeCls(disp)}">${disp}/35</span></td>`;
      }).join('');
      return `<tr>
        <td class="avail-date"><strong>${dy}/${pad(month)}/${String(year).slice(-2)}</strong><small>${dayNameShort(d)}.</small></td>
        ${cells}
      </tr>`;
    }).join('');
    container.innerHTML = `<div class="search-card" style="padding-top:20px">
      <div class="search-eyebrow"><span class="eyebrow-bar"></span><span>Todos os Carrinhos${timeLabel}</span></div>
      <div class="avail-table-wrap">
        <table class="avail-table">
          <thead><tr>
            <th>Data</th>
            ${CARRINHOS.map(c => `<th>${c}</th>`).join('')}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>${legend}
    </div>`;
  }
  btn.disabled = false;
}

function getWeekdays(year, month) {
  const days = [];
  const total = new Date(year, month, 0).getDate();
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) days.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  return days;
}

function _updateApiStatusEl() {
  const el = document.getElementById('api-status');
  if (!el) return;
  if (_apiOnline === false) {
    el.textContent = '⚠ ' + (_apiErro || 'Sem conexão com a planilha');
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function renderSituacao() {
  const container = document.getElementById('situacao-cards');
  if (!container) return;
  container.innerHTML = CARRINHOS.map(() =>
    `<div class="result-card" style="min-height:160px">
      <div class="card-top"><div class="card-name-block">
        <div class="card-name" style="background:rgba(255,255,255,.15);border-radius:6px;height:18px;width:110px"></div>
        <div class="card-name-sub" style="background:rgba(255,255,255,.1);border-radius:4px;height:12px;width:70px;margin-top:6px"></div>
      </div></div>
      <div class="card-body" style="display:flex;align-items:center;justify-content:center;min-height:80px">
        <span class="spinner-btn" style="border-color:rgba(0,48,135,.15);border-top-color:var(--blue)"></span>
      </div>
    </div>`
  ).join('');
  await fetchAll();
  _updateApiStatusEl();
  const now = new Date();
  const today = todayISO();
  function slotAtivo(slots, isNow) {
    if (!Array.isArray(slots)) return null;
    return slots.find(s => {
      if (!s || !s.retirada || !s.devolucao) return false;
      const start = parseLocal(s.retirada);
      const end = parseLocal(s.devolucao);
      return isNow
        ? (start <= now && end > now)
        : (start > now && s.retirada.slice(0, 10) === today);
    }) ?? null;
  }
  try {
    container.innerHTML = CARRINHOS.map(c => {
      const ativas = getAll().filter(r =>
        r.status === 'ativa' && r.unidade === c && Array.isArray(r.slots)
      );
      const agora = ativas.filter(r => slotAtivo(r.slots, true) !== null);
      const contAgora = agora.reduce((n, r) => n + (r.quantidade || 0), 0);
      const proximas = ativas.filter(r =>
        !agora.includes(r) && slotAtivo(r.slots, false) !== null
      );
      const pct = Math.min(100, Math.round((contAgora / MAX_NB) * 100));
      const barCls = contAgora === 0 ? 'bar-ok' : contAgora < 10 ? 'bar-mid' : contAgora < 25 ? 'bar-high' : 'bar-full';
      const pillCls = contAgora === 0 ? 'status-confirmado' : contAgora < MAX_NB ? 'status-pendente' : 'status-cancelado';
      const pillTxt = contAgora === 0 ? `${MAX_NB} livres` : contAgora < MAX_NB ? `${MAX_NB - contAgora} livres` : 'Lotado';
      function reservaRow(r, isNow) {
        const slot = slotAtivo(r.slots, isNow);
        if (!slot) return '';
        return `<div class="reserva-row ${isNow ? 'reserva-now' : ''}">
          <div class="avatar" style="width:34px;height:34px;font-size:11px;flex-shrink:0;border:none;
            background:${isNow ? 'var(--blue)' : 'var(--gray-20)'};
            color:${isNow ? '#fff' : 'var(--gray-60)'}">${getInitials(r.nome || '?')}</div>
          <div style="flex:1;min-width:0">
            <div class="info-val" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${maskName(r.nome || '')}</div>
            <div style="margin:3px 0 0;font-size:10.5px;color:var(--gray-60);font-weight:600;line-height:1.4">
              CPF ${maskCPF(r.cpf || '')} &nbsp;·&nbsp; ${r.quantidade} notebook${r.quantidade > 1 ? 's' : ''} &nbsp;·&nbsp; ${fmtTime(slot.retirada)}–${fmtTime(slot.devolucao)}
            </div>
          </div>
          ${isNow
            ? '<span class="status-pill status-confirmado" style="font-size:9px;padding:3px 7px;white-space:nowrap">Agora</span>'
            : '<span style="font-size:10.5px;color:var(--gray-40);font-weight:600;white-space:nowrap">Em breve</span>'}
        </div>`;
      }
      const rows = [
        ...agora.map(r => reservaRow(r, true)),
        ...proximas.map(r => reservaRow(r, false)),
      ].filter(Boolean).join('');
      const empty = `<div style="text-align:center;padding:16px 0;color:var(--gray-40);font-size:12px;font-weight:600">
        Livre
      </div>`;
      return `<div class="result-card">
        <div class="card-top">
          <div class="card-name-block">
            <div class="card-name">${c}</div>
            <div class="card-name-sub">${contAgora}/${MAX_NB} em uso</div>
          </div>
          <span class="status-pill ${pillCls}">${pillTxt}</span>
        </div>
        <div class="card-body">
          <div class="uso-bar-wrap">
            <div class="uso-bar-bg"><div class="uso-bar-fill ${barCls}" style="width:${pct}%"></div></div>
            <span class="uso-bar-pct">${pct}%</span>
          </div>
          ${rows || empty}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('[renderSituacao]', err);
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--red);font-size:13px">
      Erro ao renderizar dados — veja o console.
    </div>`;
  }
}

let _adminSenha = null;
function initExportar() {
  const expSenha = document.getElementById('exp-senha');
  document.getElementById('btn-eye').addEventListener('click', () => {
    expSenha.type = expSenha.type === 'password' ? 'text' : 'password';
  });
  expSenha.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-verificar-senha').click();
  });
  document.getElementById('btn-verificar-senha').addEventListener('click', async () => {
    const senha = expSenha.value;
    if (!senha) return;
    if (!API_URL) {
      toast('API não configurada. Autenticação indisponível.', 'error');
      return;
    }
    const btn = document.getElementById('btn-verificar-senha');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-btn"></span> Verificando…`;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'verificarSenha', senha }),
      });
      const data = await res.json();
      if (data.error) {
        toast(data.error, 'error');
      } else if (data.ok) {
        _adminSenha = senha;
        document.getElementById('export-lock').hidden = true;
        document.getElementById('export-form').hidden = false;
        document.getElementById('senha-error').hidden = true;
      } else {
        document.getElementById('senha-error').hidden = false;
        expSenha.focus();
      }
    } catch {
      toast('Erro ao verificar senha. Verifique a conexão.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> Acessar`;
    }
  });
  document.getElementById('btn-exportar').addEventListener('click', exportCSV);
  document.getElementById('btn-sair-export').addEventListener('click', () => {
    document.getElementById('export-lock').hidden = false;
    document.getElementById('export-form').hidden = true;
    expSenha.value = '';
    _adminSenha = null;
    document.getElementById('ger-resultado').innerHTML = '';
    fecharModal();
  });
}

async function exportCSV() {
  const btn = document.getElementById('btn-exportar');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-btn"></span> Exportando…`;
  await fetchAll(true);
  const carrinho = document.getElementById('exp-unidade').value;
  const inicio = document.getElementById('exp-inicio').value;
  const fim = document.getElementById('exp-fim').value;
  let data = getAll().filter(r => !carrinho || r.unidade === carrinho);
  if (inicio || fim) {
    data = data.filter(r =>
      r.slots.some(s => {
        const d = s.retirada.slice(0, 10);
        return (!inicio || d >= inicio) && (!fim || d <= fim);
      })
    );
  }
  const btnLabel = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar CSV`;
  if (!data.length) {
    toast('Nenhuma reserva encontrada com os filtros aplicados.', 'warn');
    btn.disabled = false;
    btn.innerHTML = btnLabel;
    return;
  }
  const header = ['ID','Nome','CPF','Carrinho','Quantidade',
    'Data Retirada','Hora Retirada','Data Devolução','Hora Devolução','Status','Criado Em'];
  const lines = [header.join(',')];
  data.forEach(r => {
    r.slots.forEach(s => {
      lines.push([
        r.id, r.nome, r.cpf, r.unidade, r.quantidade,
        fmtDateShort(s.retirada), fmtTime(s.retirada),
        fmtDateShort(s.devolucao), fmtTime(s.devolucao),
        r.status, fmtDateTimeFull(r.criadoEm),
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    });
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `reservas_${todayISO()}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`${data.length} reserva(s) exportada(s).`, 'success');
  btn.disabled = false;
  btn.innerHTML = btnLabel;
}

let _editId = null;
let _modalSlotCounter = 0;
async function cancelarReservaAPI(id) {
  if (!API_URL) {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      list[idx].status = 'cancelada';
      list[idx].devolvidoEm = new Date().toISOString();
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      _cache = list;
      _cacheTime = Date.now();
    }
    return { ok: true };
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'cancelar', id, senha: _adminSenha }),
  });
  const data = await res.json();
  if (data.error && /senha/i.test(data.error)) _voltarParaLogin();
  return data;
}

async function editarReservaAPI(id, dados) {
  if (!API_URL) {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      list[idx].quantidade = dados.quantidade;
      list[idx].slots = dados.slots;
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      _cache = list;
      _cacheTime = Date.now();
    }
    return { ok: true };
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'editar', id, dados, senha: _adminSenha }),
  });
  const data = await res.json();
  if (data.error && /senha/i.test(data.error)) _voltarParaLogin();
  return data;
}

function _voltarParaLogin() {
  _adminSenha = null;
  fecharModal();
  document.getElementById('export-lock').hidden = false;
  document.getElementById('export-form').hidden = true;
  document.getElementById('exp-senha').value = '';
  document.getElementById('ger-resultado').innerHTML = '';
}

function initGerenciar() {
  document.getElementById('btn-gerenciar').addEventListener('click', renderGerenciar);
  const qtyInput = document.getElementById('modal-quantidade');
  document.getElementById('modal-qty-minus').addEventListener('click', () => {
    const v = parseInt(qtyInput.value) || 1;
    if (v > 1) qtyInput.value = v - 1;
  });
  document.getElementById('modal-qty-plus').addEventListener('click', () => {
    const v = parseInt(qtyInput.value) || 1;
    if (v < MAX_NB) qtyInput.value = v + 1;
  });
  qtyInput.addEventListener('input', () => {
    let v = parseInt(qtyInput.value);
    if (isNaN(v) || v < 1) qtyInput.value = 1;
    if (v > MAX_NB) qtyInput.value = MAX_NB;
  });
  document.getElementById('modal-btn-add-slot').addEventListener('click', () => addModalSlotRow());
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
  document.getElementById('modal-edicao').addEventListener('click', e => {
    if (e.target === e.currentTarget) fecharModal();
  });
  document.getElementById('modal-salvar').addEventListener('click', salvarEdicao);
}

function _gerBtnLabel() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Buscar Reservas`;
}

function _salvarLabel() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18" aria-hidden="true"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar Alterações`;
}

async function renderGerenciar() {
  const btn = document.getElementById('btn-gerenciar');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-btn"></span> Buscando…`;
  await fetchAll(true);
  const carrinho = document.getElementById('ger-unidade').value;
  const inicio = document.getElementById('ger-inicio').value;
  const fim = document.getElementById('ger-fim').value;
  const nome = document.getElementById('ger-nome').value.trim().toLowerCase();
  let reservas = getAll().filter(r => r.status === 'ativa');
  if (nome) reservas = reservas.filter(r => r.nome.toLowerCase().includes(nome));
  if (carrinho) reservas = reservas.filter(r => r.unidade === carrinho);
  if (inicio || fim) {
    reservas = reservas.filter(r =>
      r.slots.some(s => {
        const d = s.retirada.slice(0, 10);
        return (!inicio || d >= inicio) && (!fim || d <= fim);
      })
    );
  }
  reservas.sort((a, b) => {
    const da = a.slots[0]?.retirada || '';
    const db = b.slots[0]?.retirada || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const container = document.getElementById('ger-resultado');
  if (!reservas.length) {
    container.innerHTML = `<p style="text-align:center;padding:20px 0;color:var(--gray-40);font-size:13px;font-weight:600">Nenhuma reserva ativa encontrada.</p>`;
  } else {
    container.innerHTML = `<div class="ger-list">${reservas.map(gerItemHTML).join('')}</div>`;
    container.querySelectorAll('.btn-ger-cancel').forEach(b =>
      b.addEventListener('click', () => handleCancelar(b.dataset.id))
    );
    container.querySelectorAll('.btn-ger-edit').forEach(b =>
      b.addEventListener('click', () => abrirModal(b.dataset.id))
    );
  }
  btn.disabled = false;
  btn.innerHTML = _gerBtnLabel();
}

function gerItemHTML(r) {
  const slotsHtml = r.slots.map(s =>
    `<span class="slot-time-badge">${fmtDatetime(s.retirada)} → ${fmtTime(s.devolucao)}h</span>`
  ).join('');
  return `<div class="ger-item" data-id="${r.id}">
    <div class="ger-item-info">
      <div class="ger-item-name">${r.nome}</div>
      <div class="ger-item-meta">${r.unidade} &middot; CPF ${maskCPF(r.cpf)} &middot; ${r.quantidade} notebook${r.quantidade !== 1 ? 's' : ''}</div>
      <div class="ger-item-slots">${slotsHtml}</div>
    </div>
    <div class="ger-item-actions">
      <button class="btn-ger btn-ger-edit" data-id="${r.id}">Editar</button>
      <button class="btn-ger btn-ger-cancel" data-id="${r.id}">Cancelar</button>
    </div>
  </div>`;
}

async function handleCancelar(id) {
  if (!confirm('Confirmar cancelamento desta reserva?\nEsta ação não pode ser desfeita.')) return;
  try {
    const res = await cancelarReservaAPI(id);
    if (res.error) { toast(res.error, 'error'); return; }
    if (_cache) {
      const idx = _cache.findIndex(r => r.id === id);
      if (idx >= 0) {
        _cache[idx].status = 'cancelada';
        _cache[idx].devolvidoEm = new Date().toISOString();
      }
    }
    document.querySelector(`.ger-item[data-id="${id}"]`)?.remove();
    toast('Reserva cancelada com sucesso.', 'success');
    renderSituacao();
  } catch {
    toast('Erro ao cancelar. Tente novamente.', 'error');
  }
}

function abrirModal(id) {
  const reserva = getAll().find(r => r.id === id);
  if (!reserva) return;
  _editId = id;
  document.getElementById('modal-avatar').textContent = getInitials(reserva.nome);
  document.getElementById('modal-nome').textContent = reserva.nome;
  document.getElementById('modal-unidade').textContent = reserva.unidade;
  document.getElementById('modal-quantidade').value = reserva.quantidade;
  const slotList = document.getElementById('modal-slot-list');
  slotList.innerHTML = '';
  _modalSlotCounter = 0;
  reserva.slots.forEach(s => addModalSlotRow(s));
  document.getElementById('modal-edicao').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  document.getElementById('modal-edicao').hidden = true;
  document.body.style.overflow = '';
  _editId = null;
}

function addModalSlotRow(slot = null) {
  _modalSlotCounter++;
  const today = todayISO();
  const retDate = slot ? slot.retirada.slice(0, 10) : today;
  const retHora = slot ? fmtTime(slot.retirada) : '08:00';
  const devDate = slot ? slot.devolucao.slice(0, 10) : today;
  const devHora = slot ? fmtTime(slot.devolucao) : '17:00';
  const row = document.createElement('div');
  row.className = 'slot-row';
  row.dataset.id = _modalSlotCounter;
  row.innerHTML = `
    <div class="slot-fields">
      <div class="slot-group">
        <span class="slot-lbl">Retirada</span>
        <div class="slot-dt">
          <input type="date" class="slot-data-ret" value="${retDate}" aria-label="Data de retirada">
          <input type="time" class="slot-hora-ret" value="${retHora}" aria-label="Hora de retirada">
        </div>
      </div>
      <div class="slot-sep">→</div>
      <div class="slot-group">
        <span class="slot-lbl">Devolução</span>
        <div class="slot-dt">
          <input type="date" class="slot-data-dev" value="${devDate}" aria-label="Data de devolução">
          <input type="time" class="slot-hora-dev" value="${devHora}" aria-label="Hora de devolução">
        </div>
      </div>
    </div>
    <button type="button" class="slot-remove" aria-label="Remover período">×</button>`;
  row.querySelector('.slot-remove').addEventListener('click', () => {
    if (document.querySelectorAll('#modal-slot-list .slot-row').length > 1) {
      row.remove();
    } else {
      toast('É necessário ao menos um período.', 'warn');
    }
  });
  document.getElementById('modal-slot-list').appendChild(row);
}

function getModalSlots() {
  return Array.from(document.querySelectorAll('#modal-slot-list .slot-row')).map(row => {
    const dataRet = row.querySelector('.slot-data-ret').value;
    const horaRet = row.querySelector('.slot-hora-ret').value;
    const dataDev = row.querySelector('.slot-data-dev').value;
    const horaDev = row.querySelector('.slot-hora-dev').value;
    return (dataRet && horaRet && dataDev && horaDev)
      ? { retirada: `${dataRet}T${horaRet}`, devolucao: `${dataDev}T${horaDev}` }
      : null;
  }).filter(Boolean);
}

async function salvarEdicao() {
  const quantidade = parseInt(document.getElementById('modal-quantidade').value) || 0;
  const slots = getModalSlots();
  if (quantidade < 1) { toast('Quantidade inválida.', 'error'); return; }
  if (!slots.length) { toast('Adicione ao menos um período.', 'error'); return; }
  for (const s of slots) {
    if (parseLocal(s.retirada) >= parseLocal(s.devolucao)) {
      toast('A devolução deve ser posterior à retirada em todos os períodos.', 'error');
      return;
    }
  }
  const btn = document.getElementById('modal-salvar');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-btn"></span> Salvando…`;
  try {
    const res = await editarReservaAPI(_editId, { quantidade, slots });
    if (res.error) {
      toast(res.error, 'error');
      btn.disabled = false;
      btn.innerHTML = _salvarLabel();
      return;
    }
    if (_cache) {
      const idx = _cache.findIndex(r => r.id === _editId);
      if (idx >= 0) { _cache[idx].quantidade = quantidade; _cache[idx].slots = slots; }
    }
    toast('Reserva atualizada com sucesso!', 'success');
    fecharModal();
    renderGerenciar();
    renderSituacao();
  } catch {
    toast('Erro ao salvar. Tente novamente.', 'error');
    btn.disabled = false;
    btn.innerHTML = _salvarLabel();
  }
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      });
      document.querySelectorAll('.tab-content').forEach(s => {
        const match = s.id === `tab-${tab}`;
        s.classList.toggle('active', match);
        s.hidden = !match;
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initReservar();
  initConsultar();
  initExportar();
  initGerenciar();
  _atualizarDatalist();
  await fetchAll();
  updateQtyHint();
  renderSituacao();
  setInterval(() => {
    fetchAll(true).then(() => renderSituacao());
  }, 60_000);
});