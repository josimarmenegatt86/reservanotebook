// ════════════════════════════════════════════════════════════
//  SENAI – Reserva de Notebooks | Code.gs
//
//  COMO USAR:
//  1. Cole este código inteiro no Apps Script (Extensões > Apps Script)
//  2. Salve (Ctrl+S)
//  3. Implantar > Gerenciar Implantações > Editar (lápis) > "Nova Versão" > Implantar
//     (use a MESMA implantação existente — não crie uma nova)
//
//  ESTRUTURA DOS SLOTS (datetime range):
//  slots: [ { retirada: "2025-06-17T08:00", devolucao: "2025-06-17T17:00" } ]
// ════════════════════════════════════════════════════════════

const SHEET_NAME = 'Reservas';
const MAX_NB     = 35;

// ─── ENTRY POINTS ──────────────────────────────────────────

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
    lock.waitLock(15000); // dentro do try: falha retorna JSON de erro, não HTML
    const body   = JSON.parse(e.postData.contents);
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

// Verifica a senha de administrador contra EXPORT_PASS (Script Properties).
// Usada para exigir autenticação no servidor antes de cancelar/editar reservas —
// a proteção do frontend sozinha só esconde a tela, não impede chamadas diretas à API.
function senhaValida(senha) {
  const correta = PropertiesService.getScriptProperties().getProperty('EXPORT_PASS') || '';
  return !!correta && senha === correta;
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── INICIALIZAÇÃO ─────────────────────────────────────────

function inicializarPlanilha() {
  getSheet();
  Logger.log('Planilha "' + SHEET_NAME + '" pronta!');
}

// ─── ACESSO À PLANILHA ─────────────────────────────────────

function getSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    _setupCabecalho(sheet);
  }
  return sheet;
}

function _setupCabecalho(sheet) {
  const cols = [
    'ID', 'Nome', 'Matrícula', 'Unidade', 'Quantidade',
    'Slots (JSON)', 'Status', 'Criado Em', 'Devolvido Em'
  ];
  sheet.appendRow(cols);
  sheet.setFrozenRows(1);

  const hdr = sheet.getRange(1, 1, 1, cols.length);
  hdr.setBackground('#003087');
  hdr.setFontColor('#ffffff');
  hdr.setFontWeight('bold');
  hdr.setFontSize(11);

  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 380);
  sheet.setColumnWidth(7, 90);
  sheet.setColumnWidth(8, 170);
  sheet.setColumnWidth(9, 170);
}

// ─── LEITURA ───────────────────────────────────────────────

function getAllReservas() {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  return sheet.getRange(2, 1, lastRow - 1, 9).getValues()
    .filter(r => r[0] !== '')
    .map(row => ({
      id:          String(row[0]),
      nome:        String(row[1]),
      matricula:   String(row[2]),
      unidade:     String(row[3]),
      quantidade:  Number(row[4]),
      slots:       safeJson(row[5]),
      status:      String(row[6]),
      criadoEm:    row[7] ? String(row[7]) : '',
      devolvidoEm: row[8] ? String(row[8]) : null,
    }));
}

function safeJson(str) {
  try { return JSON.parse(String(str)); }
  catch { return []; }
}

// ─── UTILITÁRIOS ───────────────────────────────────────────

// Converte "YYYY-MM-DDTHH:MM" para Date no fuso horário local do script.
// IMPORTANTE: new Date(string) no Apps Script interpreta sem fuso como UTC,
// por isso usamos o construtor numérico que usa o fuso local.
function parseLocalGS(str) {
  const parts = String(str).split('T');
  const ymd   = parts[0].split('-').map(Number);
  const hm    = (parts[1] || '00:00').split(':').map(Number);
  return new Date(ymd[0], ymd[1] - 1, ymd[2], hm[0], hm[1] || 0, 0);
}

// Verificação de sobreposição usando comparação de strings ISO.
// Strings "YYYY-MM-DDTHH:MM" ordenam corretamente sem conversão de fuso.
function overlapGS(slotA, slotB) {
  return slotA.retirada < slotB.devolucao &&
         slotB.retirada < slotA.devolucao;
}

// ─── ESCRITA ───────────────────────────────────────────────

function criarReserva(r) {
  if (!r || !Array.isArray(r.slots) || r.slots.length === 0) {
    return 'Reserva inválida: nenhum período informado.';
  }
  // Validação básica dos slots
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

    // Soma notebooks de reservas ativas que se sobrepõem ao novo slot
    var usado = 0;
    for (var k = 0; k < existing.length; k++) {
      var x = existing[k];
      if (x.status !== 'ativa' || x.unidade !== r.unidade) continue;
      for (var m = 0; m < x.slots.length; m++) {
        if (overlapGS(x.slots[m], newSlot)) {
          usado += x.quantidade;
          break; // conta cada reserva apenas uma vez por slot
        }
      }
    }

    if (usado + r.quantidade > MAX_NB) {
      var disp = MAX_NB - usado;
      return 'Sem disponibilidade: ' + newSlot.retirada.replace('T', ' ') +
             ' – ' + newSlot.devolucao.slice(11) +
             '. Disponível: ' + disp + ' de ' + MAX_NB + '.';
    }
  }

  getSheet().appendRow([
    r.id, r.nome, r.matricula, r.unidade, r.quantidade,
    JSON.stringify(r.slots), 'ativa', r.criadoEm, '',
  ]);

  return null; // sem erro
}

// ─── CANCELAMENTO ──────────────────────────────────────────

function cancelarReserva(id) {
  var sheet   = getSheet();
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

// ─── EDIÇÃO ────────────────────────────────────────────────

function editarReserva(id, dados) {
  if (!dados || !Array.isArray(dados.slots) || dados.slots.length === 0) {
    return 'Nenhum período informado.';
  }
  for (var i = 0; i < dados.slots.length; i++) {
    var s = dados.slots[i];
    if (!s.retirada || !s.devolucao) return 'Período inválido: campos ausentes.';
    if (s.retirada >= s.devolucao)   return 'Período inválido: devolução deve ser posterior à retirada.';
  }

  var sheet   = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 'Reserva não encontrada.';

  var rows      = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var targetRow = -1, targetUnidade = '';

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      if (rows[i][6] !== 'ativa') return 'Reserva não está ativa.';
      targetRow      = i + 2;
      targetUnidade  = String(rows[i][3]);
      break;
    }
  }
  if (targetRow === -1) return 'Reserva não encontrada.';

  // Verifica disponibilidade excluindo a reserva atual
  var existing = getAllReservas().filter(function(r) { return r.id !== String(id); });

  for (var j = 0; j < dados.slots.length; j++) {
    var newSlot = dados.slots[j];
    var usado   = 0;
    for (var k = 0; k < existing.length; k++) {
      var x = existing[k];
      if (x.status !== 'ativa' || x.unidade !== targetUnidade) continue;
      for (var m = 0; m < x.slots.length; m++) {
        if (overlapGS(x.slots[m], newSlot)) { usado += x.quantidade; break; }
      }
    }
    if (usado + dados.quantidade > MAX_NB) {
      var disp = MAX_NB - usado;
      return 'Sem disponibilidade: ' + newSlot.retirada.replace('T', ' ') +
             ' – ' + newSlot.devolucao.slice(11) +
             '. Disponível: ' + disp + ' de ' + MAX_NB + '.';
    }
  }

  sheet.getRange(targetRow, 5).setValue(dados.quantidade);
  sheet.getRange(targetRow, 6).setValue(JSON.stringify(dados.slots));
  return null;
}

// ─── DEVOLUÇÃO AUTOMÁTICA ──────────────────────────────────

function processAutoReturn() {
  var sheet   = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var now     = new Date();
  var rows    = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var updates = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row[6] !== 'ativa') continue;

    var slots    = safeJson(row[5]);
    var anyActive = false;

    for (var j = 0; j < slots.length; j++) {
      var s = slots[j];
      if (!s.devolucao) continue;
      // parseLocalGS usa construtor numérico → fuso local do spreadsheet
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
