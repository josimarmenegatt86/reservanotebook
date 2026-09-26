const SHEET_NAME = 'Reservas';
const FUNC_SHEET_NAME = 'Funcionarios';
const MAX_NB = 35;

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || '';
    if (action === 'getAll') {
      processAutoReturn();
      return jsonOk(getAllReservas());
    }
    if (action === 'getFuncionarios') {
      return jsonOk({ funcionarios: listarFuncionarios() });
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
    if (action === 'finalizar') {
      const erro = finalizarReserva(body.id, body.observacao);
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
  getFuncionariosSheet();
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    _setupCabecalho(sheet);
  } else {
    _garantirColunaObservacao(sheet);
  }
  return sheet;
}

function _setupCabecalho(sheet) {
  const cols = ['ID', 'Nome', 'Matrícula', 'Carrinho', 'Quantidade', 'Slots (JSON)', 'Status', 'Criado Em', 'Devolvido Em', 'Observação / Defeito Reportado'];
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
  sheet.setColumnWidth(10, 320);
}

// Garante que planilhas criadas antes desta atualização recebam a coluna J.
function _garantirColunaObservacao(sheet) {
  if (sheet.getLastColumn() < 10) {
    sheet.getRange(1, 10).setValue('Observação / Defeito Reportado');
    sheet.getRange(1, 10).setBackground('#003087').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
    sheet.setColumnWidth(10, 320);
  }
}

function getFuncionariosSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FUNC_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FUNC_SHEET_NAME);
    const cols = ['Nome', 'Matrícula'];
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    const hdr = sheet.getRange(1, 1, 1, cols.length);
    hdr.setBackground('#003087');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
    hdr.setFontSize(11);
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 140);
  }
  return sheet;
}

function listarFuncionarios() {
  const sheet = getFuncionariosSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    .filter(r => String(r[0]).trim() !== '' && String(r[1]).trim() !== '')
    .map(r => ({
      nome: String(r[0]).trim(),
      matricula: String(r[1]).trim(),
    }));
}

// Valida se o par nome + matrícula existe na aba Funcionarios.
// Retorna null se válido, ou mensagem de erro.
function validarFuncionario(nome, matricula) {
  if (!nome || !String(nome).trim()) return 'Nome inválido: selecione um funcionário da lista.';
  if (!matricula || String(matricula).trim() === '') return 'Matrícula inválida: informe a matrícula.';
  const funcs = listarFuncionarios();
  if (funcs.length === 0) return 'Nenhum funcionário cadastrado na aba "Funcionarios" da planilha.';
  const nomeNorm = String(nome).trim().toLowerCase();
  const matNorm = String(matricula).trim();
  const encontrouNome = funcs.some(f => f.nome.toLowerCase() === nomeNorm);
  if (!encontrouNome) return 'Funcionário não cadastrado: selecione um nome da lista.';
  const parValido = funcs.some(f => f.nome.toLowerCase() === nomeNorm && f.matricula === matNorm);
  if (!parValido) return 'Matrícula não corresponde ao funcionário selecionado. Cadastro recusado.';
  return null;
}

function getAllReservas() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 10).getValues()
    .filter(r => r[0] !== '')
    .map(row => ({
      id: String(row[0]),
      nome: String(row[1]),
      matricula: String(row[2]),
      unidade: String(row[3]),
      quantidade: Number(row[4]),
      slots: safeJson(row[5]),
      status: String(row[6]),
      criadoEm: row[7] ? String(row[7]) : '',
      devolvidoEm: row[8] ? String(row[8]) : null,
      observacao: row[9] ? String(row[9]) : '',
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
  const erroFunc = validarFuncionario(r.nome, r.matricula);
  if (erroFunc) return erroFunc;
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
    r.id, r.nome, r.matricula, r.unidade, r.quantidade,
    JSON.stringify(r.slots), 'ativa', r.criadoEm, '', '',
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

// O próprio professor confirma que finalizou o uso e devolveu o(s) notebook(s),
// opcionalmente relatando algum defeito encontrado. Não exige senha de admin
// porque é uma ação sobre a própria reserva ativa, mas só é permitida enquanto
// a reserva ainda estiver 'ativa' (evita reabrir reservas já canceladas/devolvidas).
function finalizarReserva(id, observacao) {
  if (!id) return 'Reserva inválida.';
  var obsTexto = observacao ? String(observacao).trim().slice(0, 500) : '';
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 'Reserva não encontrada.';
  var rows = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      if (rows[i][6] !== 'ativa') return 'Esta reserva já foi finalizada, devolvida ou cancelada anteriormente.';
      var linha = i + 2;
      sheet.getRange(linha, 7).setValue('devolvida');
      sheet.getRange(linha, 9).setValue(new Date().toISOString());
      if (obsTexto) sheet.getRange(linha, 10).setValue(obsTexto);
      return null;
    }
  }
  return 'Reserva não encontrada.';
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