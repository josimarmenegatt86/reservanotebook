'use strict';
const API_URL = 'https://script.google.com/macros/s/AKfycbwZTCdHVnjMpjel3_e5SdtM5KGezSipIIa1fW-X4Xl_zU4-OmNsFTDzRzymreTyzrBW/exec';
const MAX_NB = 35;
const CARRINHOS = ['Carrinho 1', 'Carrinho 2'];
let _cache = null;

async function fetchAll(force = false) {
  if (!force && _cache !== null) return _cache;
  const res = await fetch(`${API_URL}?action=getAll`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(data.error || 'Resposta inválida do servidor');
  _cache = data;
  return _cache;
}

function getAll() {
  return _cache || [];
}

async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function pad(n) { return String(n).padStart(2, '0'); }

function parseLocal(str) {
  const [d, t = '00:00'] = String(str).split('T');
  const [y, mo, dy] = d.split('-').map(Number);
  const [h, mi = 0] = t.split(':').map(Number);
  return new Date(y, mo - 1, dy, h, mi, 0);
}

function fmtTime(iso) {
  const d = parseLocal(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateShort(iso) {
  const d = parseLocal(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

function fmtDatetime(iso) {
  return `${fmtDateShort(iso)} ${fmtTime(iso)}h`;
}

function fmtDateTimeFull(isoZ) {
  if (!isoZ) return '';
  const d = new Date(isoZ);
  if (isNaN(d)) return String(isoZ);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function statusBadge(status) {
  const map = {
    ativa: '<span class="status-pill status-confirmado">Ativa</span>',
    devolvida: '<span class="status-pill status-pendente">Devolvida</span>',
    cancelada: '<span class="status-pill status-cancelado">Cancelada</span>',
  };
  return map[status] || `<span class="status-pill status-pendente">${escapeHtml(status)}</span>`;
}

let _toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className = `toast ${type ? 'toast-' + type : ''} show`;
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3400);
}

function peakUsage(carrinho, dateISO) {
  const dayStart = parseLocal(dateISO + 'T00:00');
  const dayEnd = parseLocal(dateISO + 'T23:59');
  const events = [];
  getAll()
    .filter(r => r.status === 'ativa' && r.unidade === carrinho)
    .forEach(r => {
      (r.slots || []).forEach(s => {
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

function initTabs() {
  const btns = Array.from(document.querySelectorAll('.tab-btn[data-tab]'));
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      btns.forEach(b => {
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

function reservaItemHTML(r) {
  const slotsHtml = (r.slots || []).map(s =>
    `<span class="slot-time-badge">${fmtDatetime(s.retirada)} → ${fmtTime(s.devolucao)}h</span>`
  ).join('');
  const obsHtml = r.observacao
    ? `<div class="ger-item-defeito"><span class="defeito-icon">⚠️</span> <strong>Defeito reportado:</strong> ${escapeHtml(r.observacao)}</div>`
    : '';
  const acoes = [];
  if (r.status === 'ativa') {
    acoes.push(`<button type="button" class="btn-ger btn-ger-edit" data-editar-id="${r.id}">Editar</button>`);
    acoes.push(`<button type="button" class="btn-ger btn-ger-cancel" data-cancelar-id="${r.id}">Cancelar</button>`);
  }
  return `<div class="ger-item" data-id="${r.id}">
    <div class="ger-item-info">
      <div class="ger-item-name">${escapeHtml(r.nome)}</div>
      <div class="ger-item-meta">${escapeHtml(r.unidade)} &middot; Matrícula ${escapeHtml(r.matricula || '—')} &middot; ${r.quantidade} notebook${r.quantidade !== 1 ? 's' : ''} &middot; Criada em ${fmtDateTimeFull(r.criadoEm)}</div>
      <div class="ger-item-slots">${slotsHtml}</div>
      ${obsHtml}
    </div>
    <div class="ger-item-actions">${statusBadge(r.status)}${acoes.join('')}</div>
  </div>`;
}

function renderReservas() {
  const lista = getAll()
    .slice()
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const container = document.getElementById('adm-reservas-lista');
  if (!lista.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">📋</div><h3>Nenhuma reserva encontrada</h3><p>Ainda não há reservas registradas na planilha.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="search-card" style="padding-top:20px">
    <div class="search-eyebrow"><span class="eyebrow-bar"></span><span>${lista.length} reserva(s) — ordenadas da mais recente</span></div>
    <div class="ger-list">${lista.map(reservaItemHTML).join('')}</div>
  </div>`;
}

function renderProblemas() {
  const problemas = getAll()
    .filter(r => r.observacao && String(r.observacao).trim() !== '')
    .sort((a, b) => String(b.devolvidoEm || '').localeCompare(String(a.devolvidoEm || '')));
  const container = document.getElementById('adm-problemas-lista');
  if (!problemas.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">✅</div><h3>Nenhum defeito reportado</h3><p>Nenhuma reserva foi finalizada com relato de problema até agora.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="search-card" style="padding-top:20px">
    <div class="search-eyebrow"><span class="eyebrow-bar"></span><span>${problemas.length} problema(s) reportado(s)</span></div>
    <div class="ger-list">${problemas.map(r => `
      <div class="ger-item">
        <div class="ger-item-info">
          <div class="ger-item-name">${escapeHtml(r.nome)}</div>
          <div class="ger-item-meta">${escapeHtml(r.unidade)} &middot; ${r.quantidade} notebook${r.quantidade !== 1 ? 's' : ''} &middot; Devolvida em ${fmtDateTimeFull(r.devolvidoEm)}</div>
          <div class="ger-item-defeito"><span class="defeito-icon">⚠️</span> ${escapeHtml(r.observacao)}</div>
        </div>
      </div>
    `).join('')}</div>
  </div>`;
}

function renderStats() {
  const ativas = getAll().filter(r => r.status === 'ativa');
  const agora = new Date();
  let emUso = 0;
  ativas.forEach(r => {
    (r.slots || []).forEach(s => {
      if (parseLocal(s.retirada) <= agora && parseLocal(s.devolucao) > agora) emUso += r.quantidade;
    });
  });
  const problemas = getAll().filter(r => r.observacao && String(r.observacao).trim() !== '').length;
  document.getElementById('adm-stats').innerHTML = `
    <div class="stat-card"><div class="stat-val">${ativas.length}</div><div class="stat-lbl">Reservas ativas</div></div>
    <div class="stat-card"><div class="stat-val">${emUso}/${MAX_NB}</div><div class="stat-lbl">Notebooks em uso agora</div></div>
    <div class="stat-card"><div class="stat-val">${problemas}</div><div class="stat-lbl">Defeitos reportados</div></div>`;
}

// ── Gráfico 1: pico de notebooks em uso por dia (mês atual, por carrinho) ──
function renderGraficos() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const total = new Date(year, month, 0).getDate();
  const mesLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const ALTURA = 160;
  const container = document.getElementById('adm-graficos');
  container.innerHTML = CARRINHOS.map(c => {
    const dias = [];
    for (let d = 1; d <= total; d++) {
      const iso = `${year}-${pad(month)}-${pad(d)}`;
      dias.push({ dia: d, peak: peakUsage(c, iso) });
    }
    const cols = dias.map(x => {
      const h = Math.max(Math.round((x.peak / MAX_NB) * ALTURA), x.peak > 0 ? 6 : 2);
      const cor = x.peak === 0 ? '#d8dde6' : x.peak >= MAX_NB * 0.9 ? 'var(--red)' : x.peak >= MAX_NB * 0.6 ? 'var(--orange)' : 'var(--blue)';
      return `<div class="adm-chart-col" title="${pad(x.dia)}/${pad(month)} — pico de ${x.peak} notebooks">
        ${x.peak > 0 ? `<span class="adm-chart-val">${x.peak}</span>` : ''}
        <div class="adm-chart-bar" style="height:${h}px;background:${cor}"></div>
        <span class="adm-chart-day">${x.dia}</span>
      </div>`;
    }).join('');
    return `<div class="adm-chart-card">
      <div class="adm-chart-title">${c} — ${mesLabel}</div>
      <div class="adm-chart-bars">${cols}</div>
      <div class="adm-chart-legend">
        <span class="legend-dot" style="background:var(--blue)"></span> até 60%
        <span class="legend-dot" style="background:var(--orange)"></span> 60–89%
        <span class="legend-dot" style="background:var(--red)"></span> 90%+
        <span class="legend-dot" style="background:#d8dde6"></span> sem uso
      </div>
    </div>`;
  }).join('');
}

// ── Gráfico 2: reservas criadas por mês (últimos 6 meses) ──
function renderGraficosMensais() {
  const container = document.getElementById('adm-graficos-mensais');
  const now = new Date();
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push({ y: d.getFullYear(), m: d.getMonth() + 1, reservas: 0, notebooks: 0 });
  }
  getAll().forEach(r => {
    if (!r.criadoEm) return;
    const d = new Date(r.criadoEm);
    if (isNaN(d)) return;
    const alvo = meses.find(x => x.y === d.getFullYear() && x.m === d.getMonth() + 1);
    if (alvo) {
      alvo.reservas++;
      alvo.notebooks += (r.quantidade || 0);
    }
  });
  const max = Math.max(1, ...meses.map(x => x.reservas));
  const totalReservas = meses.reduce((n, x) => n + x.reservas, 0);
  const totalNotebooks = meses.reduce((n, x) => n + x.notebooks, 0);
  const ALTURA = 160;
  const cols = meses.map(x => {
    const h = Math.max(Math.round((x.reservas / max) * ALTURA), x.reservas > 0 ? 8 : 3);
    const nome = new Date(x.y, x.m - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'short' })
      .replace('.', '');
    return `<div class="adm-chart-col adm-chart-col-month" title="${nome}/${x.y} — ${x.reservas} reserva(s), ${x.notebooks} notebook(s)">
      <span class="adm-chart-val">${x.reservas}</span>
      <div class="adm-chart-bar" style="height:${h}px;background:${x.reservas > 0 ? 'var(--orange)' : '#d8dde6'}"></div>
      <span class="adm-chart-day">${nome}</span>
    </div>`;
  }).join('');
  container.innerHTML = `<div class="adm-chart-card">
    <div class="adm-chart-title">Reservas por Mês — últimos 6 meses</div>
    <div class="adm-chart-bars adm-chart-bars-month">${cols}</div>
    <div class="adm-chart-legend">
      Total: <strong>${totalReservas} reserva(s)</strong> ·
      <strong>${totalNotebooks}</strong> notebook(s) reservado(s)
    </div>
  </div>`;
}

function initAcoesReservas() {
  document.getElementById('adm-reservas-lista').addEventListener('click', async (ev) => {
    const btnEdit = ev.target.closest('[data-editar-id]');
    const btnCancel = ev.target.closest('[data-cancelar-id]');
    if (btnEdit) {
      const r = getAll().find(x => String(x.id) === String(btnEdit.dataset.editarId));
      if (r) abrirModalEditar(r);
    }
    if (btnCancel) {
      const id = btnCancel.dataset.cancelarId;
      if (!confirm('Cancelar esta reserva? Esta ação não pode ser desfeita.')) return;
      btnCancel.disabled = true;
      const data = await apiPost({ action: 'cancelar', id, token: sessionStorage.getItem('adm_token') });
      if (data.error) {
        toast(data.error, 'error');
        btnCancel.disabled = false;
        return;
      }
      toast('Reserva cancelada.', 'success');
      await recarregar();
    }
  });
}

function abrirModalEditar(r) {
  fecharModalEditar();
  const slotsHtml = (r.slots || []).map((s, i) => `
    <div class="modal-slot-row" data-idx="${i}">
      <div class="modal-slot-label">Período ${i + 1}</div>
      <div class="modal-slot-fields">
        <input type="datetime-local" class="med-ret" value="${s.retirada}">
        <input type="datetime-local" class="med-dev" value="${s.devolucao}">
      </div>
    </div>
  `).join('');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'modal-editar';
  wrap.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <span>Editar Reserva</span>
        <button type="button" class="modal-close" id="modal-editar-close" aria-label="Fechar">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-reserva-info">
          <div class="card-name-block">
            <div class="card-name">${escapeHtml(r.nome)}</div>
            <div class="card-name-sub">${escapeHtml(r.unidade)} &middot; Matrícula ${escapeHtml(r.matricula || '—')}</div>
          </div>
        </div>
        <div class="field-wrap" style="margin-top:16px">
          <label for="med-quantidade">Quantidade de Notebooks</label>
          <input type="number" id="med-quantidade" value="${r.quantidade}" min="1" max="${MAX_NB}">
        </div>
        <div class="field-wrap">
          <label>Períodos (retirada → devolução)</label>
          <div id="modal-slot-list">${slotsHtml}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-novo" id="modal-editar-cancelar" style="flex:1">Cancelar</button>
        <button type="button" class="btn-buscar" id="modal-editar-salvar" style="flex:1;height:44px;margin-top:0">Salvar Alterações</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  document.getElementById('modal-editar-close').addEventListener('click', fecharModalEditar);
  document.getElementById('modal-editar-cancelar').addEventListener('click', fecharModalEditar);
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) fecharModalEditar(); });
  document.getElementById('modal-editar-salvar').addEventListener('click', () => salvarEdicao(r.id));
}

function fecharModalEditar() {
  const el = document.getElementById('modal-editar');
  if (el) el.remove();
}

async function salvarEdicao(id) {
  const quantidade = parseInt(document.getElementById('med-quantidade').value) || 0;
  const rows = Array.from(document.querySelectorAll('#modal-slot-list .modal-slot-row'));
  const slots = rows.map(row => ({
    retirada: row.querySelector('.med-ret').value,
    devolucao: row.querySelector('.med-dev').value,
  }));
  if (!quantidade || quantidade < 1) { toast('Quantidade inválida.', 'error'); return; }
  if (slots.some(s => !s.retirada || !s.devolucao)) { toast('Preencha todas as datas e horários.', 'error'); return; }
  if (slots.some(s => s.retirada >= s.devolucao)) { toast('A devolução deve ser posterior à retirada.', 'error'); return; }
  const btn = document.getElementById('modal-editar-salvar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-btn"></span> Salvando…';
  const data = await apiPost({ action: 'editar', id, token: sessionStorage.getItem('adm_token'), dados: { quantidade, slots } });
  if (data.error) {
    toast(data.error, 'error');
    btn.disabled = false;
    btn.textContent = 'Salvar Alterações';
    return;
  }
  fecharModalEditar();
  toast('Reserva atualizada com sucesso!', 'success');
  await recarregar();
}

async function recarregar() {
  try {
    await fetchAll(true);
    renderStats();
    renderReservas();
    renderProblemas();
    renderGraficos();
    renderGraficosMensais();
  } catch (err) {
    toast('Erro ao recarregar dados: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sessionStorage.getItem('adm_token')) {
    window.location.href = 'index.html';
    return;
  }
  initTabs();
  initAcoesReservas();
  document.getElementById('btn-adm-logout').addEventListener('click', () => {
    sessionStorage.removeItem('adm_token');
    window.location.href = 'index.html';
  });
  try {
    await fetchAll(true);
    renderStats();
    renderReservas();
    renderProblemas();
    renderGraficos();
    renderGraficosMensais();
  } catch (err) {
    toast('Erro ao carregar dados: ' + err.message, 'error');
  }
});