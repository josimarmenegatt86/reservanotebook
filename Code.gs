const SHEET_NAME = 'Reservas';
const MAX_NB = 35;

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || '';
    if (action === 'getAll') {
      processAutoReturn();
      return jsonOk(getAllReservas());
    }
    return jsonOk({ error: 'unknown_action: ' + action });
  } catch (err) {
    return jsonOk({ error: err.toString() });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    if (action === 'verificarSenha') {
      const correta = PropertiesService.getScriptProperties().getProperty('EXPORT_PASS') || '';
      if (!correta) return jsonOk({ error: 'Senha não configurada no servidor. Adicione a propriedade EXPORT_PASS nas configurações do projeto Apps Script.' });
      return jsonOk({ ok: body.senha === correta });
    }
    if (action === 'criar') {
      const erro = criarReserva(body.reserva);
      if (erro) return jsonOk({ error: erro });
      return jsonOk({ ok: true });
    }
    if (action === 'cancelar') {
      if (!senhaValida(body.senha)) return jsonOk({ error: 'Senha de administrador inválida ou expirada.' });
      const erro = cancelarReserva(body.id);
      if (erro) return jsonOk({ error: erro });
      return jsonOk({ ok: true });
    }
    if (action === 'editar') {
      if (!senhaValida(body.senha)) return jsonOk({ error: 'Senha de administrador inválida ou expirada.' });
      const erro = editarReserva(body.id, body.dados);
      if (erro) return jsonOk({ error: erro });
      return jsonOk({ ok: true });
    }
    return jsonOk({ error: 'unknown_action: ' + action });
  } catch (err) {
    return jsonOk({ error: err.toString() });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function senhaValida(senha) {
  const correta = PropertiesService.getScriptProperties().getProperty('EXPORT_PASS') || '';
  return !!correta && senha === correta;
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function inicializarPlanilha() {
  getSheet();
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    _setupCabecalho(sheet);
  }
  return sheet;
}

function _setupCabecalho(sheet) {
  const cols = ['ID', 'Nome', 'CPF', 'Carrinho', 'Quantidade', 'Slots (JSON)', 'Status', 'Criado Em', 'Devolvido Em'];
  sheet.appendRow(cols);
  sheet.setFrozenRows(1);
  const hdr = sheet.getRange(1, 1, 1, cols.length);
  hdr.setBackground('#003087');
  hdr.setFontColor('#ffffff');
  hdr.setFontWeight('bold');
  hdr.setFontSize(11);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 380);
  sheet.setColumnWidth(7, 90);
  sheet.setColumnWidth(8, 170);
  sheet.setColumnWidth(9, 170);
}

function getAllReservas() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 9).getValues()
    .filter(r => r[0] !== '')
    .map(row => ({
      id: String(row[0]),
      nome: String(row[1]),
      cpf: String(row[2]),
      unidade: String(row[3]),
      quantidade: Number(row[4]),
      slots: safeJson(row[5]),
      status: String(row[6]),
      criadoEm: row[7] ? String(row[7]) : '',
      devolvidoEm: row[8] ? String(row[8]) : null,
    }));
}

function safeJson(str) {
  try { return JSON.parse(String(str)); }
  catch { return []; }
}

function parseLocalGS(str) {
  const parts = String(str).split('T');
  const ymd = parts[0].split('-').map(Number);
  const hm = (parts[1] || '00:00').split(':').map(Number);
  return new Date(ymd[0], ymd[1] - 1, ymd[2], hm[0], hm[1] || 0, 0);
}

function overlapGS(slotA, slotB) {
  return slotA.retirada < slotB.devolucao && slotB.retirada < slotA.devolucao;
}

function criarReserva(r) {
  if (!r || !Array.isArray(r.slots) || r.slots.length === 0) {
    return 'Reserva inválida: nenhum período informado.';
  }
  if (!r.cpf || !/^\d{11}$/.test(String(r.cpf).replace(/\D/g, ''))) {
    return 'CPF inválido: informe os 11 dígitos.';
  }
  for (var i = 0; i < r.slots.length; i++) {
    var s = r.slots[i];
    if (!s.retirada || !s.devolucao) {
      return 'Período inválido: campos de retirada ou devolução ausentes.';
    }
    if (s.retirada >= s.devolucao) {
      return 'Período inválido: a devolução deve ser posterior à retirada.';
    }
  }
  var existing = getAllReservas();
  for (var j = 0; j < r.slots.length; j++) {
    var newSlot = r.slots[j];
    var usado = 0;
    for (var k = 0; k < existing.length; k++) {
      var x = existing[k];
      if (x.status !== 'ativa' || x.unidade !== r.unidade) continue;
      for (var m = 0; m < x.slots.length; m++) {
        if (overlapGS(x.slots[m], newSlot)) {
          usado += x.quantidade;
          break;
        }
      }
    }
    if (usado + r.quantidade > MAX_NB) {
      var disp = MAX_NB - usado;
      return 'Sem disponibilidade: ' + newSlot.retirada.replace('T', ' ') + ' – ' + newSlot.devolucao.slice(11) + '. Disponível: ' + disp + ' de ' + MAX_NB + '.';
    }
  }
  getSheet().appendRow([
    r.id, r.nome, r.cpf, r.unidade, r.quantidade,
    JSON.stringify(r.slots), 'ativa', r.criadoEm, '',
  ]);
  return null;
}

function cancelarReserva(id) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 'Reserva não encontrada.';
  var rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      if (rows[i][6] !== 'ativa') return 'Reserva não está ativa.';
      sheet.getRange(i + 2, 7).setValue('cancelada');
      sheet.getRange(i + 2, 9).setValue(new Date().toISOString());
      return null;
    }
  }
  return 'Reserva não encontrada.';
}

function editarReserva(id, dados) {
  if (!dados || !Array.isArray(dados.slots) || dados.slots.length === 0) {
    return 'Nenhum período informado.';
  }
  for (var i = 0; i < dados.slots.length; i++) {
    var s = dados.slots[i];
    if (!s.retirada || !s.devolucao) return 'Período inválido: campos ausentes.';
    if (s.retirada >= s.devolucao) return 'Período inválido: devolução deve ser posterior à retirada.';
  }
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 'Reserva não encontrada.';
  var rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var targetRow = -1, targetCarrinho = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      if (rows[i][6] !== 'ativa') return 'Reserva não está ativa.';
      targetRow = i + 2;
      targetCarrinho = String(rows[i][3]);
      break;
    }
  }
  if (targetRow === -1) return 'Reserva não encontrada.';
  var existing = getAllReservas().filter(function(r) { return r.id !== String(id); });
  for (var j = 0; j < dados.slots.length; j++) {
    var newSlot = dados.slots[j];
    var usado = 0;
    for (var k = 0; k < existing.length; k++) {
      var x = existing[k];
      if (x.status !== 'ativa' || x.unidade !== targetCarrinho) continue;
      for (var m = 0; m < x.slots.length; m++) {
        if (overlapGS(x.slots[m], newSlot)) { usado += x.quantidade; break; }
      }
    }
    if (usado + dados.quantidade > MAX_NB) {
      var disp = MAX_NB - usado;
      return 'Sem disponibilidade: ' + newSlot.retirada.replace('T', ' ') + ' – ' + newSlot.devolucao.slice(11) + '. Disponível: ' + disp + ' de ' + MAX_NB + '.';
    }
  }
  sheet.getRange(targetRow, 5).setValue(dados.quantidade);
  sheet.getRange(targetRow, 6).setValue(JSON.stringify(dados.slots));
  return null;
}

function processAutoReturn() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var now = new Date();
  var rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var updates = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row[6] !== 'ativa') continue;
    var slots = safeJson(row[5]);
    var anyActive = false;
    for (var j = 0; j < slots.length; j++) {
      var s = slots[j];
      if (!s.devolucao) continue;
      if (parseLocalGS(s.devolucao) > now) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive) {
      updates.push({ linha: i + 2, ts: now.toISOString() });
    }
  }
  for (var u = 0; u < updates.length; u++) {
    sheet.getRange(updates[u].linha, 7).setValue('devolvida');
    sheet.getRange(updates[u].linha, 9).setValue(updates[u].ts);
  }
}