/**
 * Code.gs — backend do Prospecta (Google Apps Script)
 *
 * COMO PUBLICAR:
 * 1. Abra script.google.com (ou Extensões > Apps Script dentro da planilha).
 * 2. Cole este arquivo inteiro em Code.gs.
 * 3. Ajuste MASTER_SHEET_ID abaixo com o ID da planilha master (a que recebe tudo).
 *    Cada vendedor pode ter sua própria cópia deste script ligado à SUA planilha
 *    (SpreadsheetApp.getActiveSpreadsheet()), que grava nele e também na master.
 * 4. Implantar > Nova implantação > Tipo: App da Web.
 *    - Executar como: Eu (sua conta)
 *    - Quem tem acesso: Qualquer pessoa
 * 5. Copie a URL gerada (termina em /exec) e cole em Configurações no app.
 *
 * ESTRUTURA DE ABAS CRIADAS AUTOMATICAMENTE NA PLANILHA DO USUÁRIO:
 * - Config      (chave | valor)
 * - Contatos    (id | nome | telefone | empresa | cidade | cargo | observacoes | lista |
 *                status | ultimaLigacao | qtdLigacoes | proximoRetorno | resumo)
 * - Historico   (id | contatoId | data | status | resumo | proximaData)
 *
 * ABA NA PLANILHA MASTER ("Registros"):
 * usuario | lista | nome | telefone | empresa | status | resumo | data | hora |
 * proximoRetorno | reuniao | venda | observacoes
 */

const MASTER_SHEET_ID = 'COLE_AQUI_O_ID_DA_PLANILHA_MASTER';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || {};
    const handlers = {
      saveConfig, getConfig, importContacts, getLists, getListContacts,
      getNextContact, getContactHistory, saveCallLog, getReports, getAchievements,
      renameList, deleteList,
    };
    if (!handlers[action]) throw new Error('Ação desconhecida: ' + action);
    const result = handlers[action](payload);
    return jsonResponse({ result });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ result: 'Prospecta API ativa.' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Planilhas ----------
function userSS() { return SpreadsheetApp.getActiveSpreadsheet(); }
function masterSS() { return SpreadsheetApp.openById(MASTER_SHEET_ID); }

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map((row) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i]));
    return obj;
  });
}

function normalizePhone(phone) {
  return (phone || '').toString().replace(/\D/g, '');
}

// ---------- Config ----------
function saveConfig(payload) {
  const sheet = getOrCreateSheet(userSS(), 'Config', ['chave', 'valor']);
  const rows = sheet.getDataRange().getValues();
  const setKV = (key, value) => {
    const idx = rows.findIndex((r) => r[0] === key);
    if (idx > 0) sheet.getRange(idx + 1, 2).setValue(value);
    else sheet.appendRow([key, value]);
  };
  setKV('nome', payload.nome);
  setKV('metaLigacoes', payload.metaLigacoes);
  setKV('metaReunioes', payload.metaReunioes);
  return { ok: true };
}

function getConfig() {
  const sheet = userSS().getSheetByName('Config');
  if (!sheet) return {};
  const obj = {};
  sheet.getDataRange().getValues().forEach((r) => (obj[r[0]] = r[1]));
  return obj;
}

// ---------- Contatos / Listas ----------
const CONTATOS_HEADERS = ['id', 'nome', 'telefone', 'empresa', 'cidade', 'cargo', 'observacoes',
  'lista', 'status', 'ultimaLigacao', 'qtdLigacoes', 'proximoRetorno', 'resumo'];

function importContacts(payload) {
  const sheet = getOrCreateSheet(userSS(), 'Contatos', CONTATOS_HEADERS);
  payload.contacts.forEach((c) => {
    const id = Utilities.getUuid();
    sheet.appendRow([id, c.nome, c.telefone, c.empresa || '', c.cidade || '', c.cargo || '',
      c.observacoes || '', payload.listName, '', '', 0, '', '']);
  });
  return { ok: true, count: payload.contacts.length };
}

function getLists() {
  const sheet = userSS().getSheetByName('Contatos');
  if (!sheet) return [];
  const contatos = sheetToObjects(sheet);
  const byList = {};
  contatos.forEach((c) => {
    if (!byList[c.lista]) byList[c.lista] = { nome: c.lista, qtd: 0, feitos: 0 };
    byList[c.lista].qtd++;
    if (c.status) byList[c.lista].feitos++;
  });
  return Object.values(byList).map((l) => {
    const pct = l.qtd ? Math.round((l.feitos / l.qtd) * 100) : 0;
    return { nome: l.nome, qtd: l.qtd, pct, status: pct === 100 ? 'Finalizada' : pct === 0 ? 'Não iniciada' : 'Em andamento' };
  });
}

function getListContacts(payload) {
  const sheet = userSS().getSheetByName('Contatos');
  if (!sheet) return [];
  return sheetToObjects(sheet).filter((c) => c.lista === payload.listName);
}

function renameList(payload) {
  const sheet = userSS().getSheetByName('Contatos');
  if (!sheet) return { ok: true };
  const data = sheet.getDataRange().getValues();
  const listaCol = data[0].indexOf('lista');
  for (let i = 1; i < data.length; i++) {
    if (data[i][listaCol] === payload.oldName) {
      sheet.getRange(i + 1, listaCol + 1).setValue(payload.newName);
    }
  }
  return { ok: true };
}

function deleteList(payload) {
  const sheet = userSS().getSheetByName('Contatos');
  if (!sheet) return { ok: true };
  const data = sheet.getDataRange().getValues();
  const listaCol = data[0].indexOf('lista');
  // percorre de baixo pra cima pra não bagunçar os índices ao deletar
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][listaCol] === payload.listName) sheet.deleteRow(i + 1);
  }
  return { ok: true };
}

function getNextContact(payload) {
  const sheet = userSS().getSheetByName('Contatos');
  if (!sheet) return null;
  const excludeIds = payload.excludeIds || [];
  const contatos = sheetToObjects(sheet).filter((c) => c.lista === payload.listName);
  const disponiveis = contatos.filter((c) => !c.status && excludeIds.indexOf(c.id) === -1);
  return disponiveis[0] || contatos.find((c) => !c.status) || null;
}

function getContactHistory(payload) {
  const sheet = userSS().getSheetByName('Historico');
  if (!sheet) return [];
  const alvo = normalizePhone(payload.telefone);
  return sheetToObjects(sheet)
    .filter((h) => normalizePhone(h.telefone) === alvo)
    .sort((a, b) => new Date(b.data) - new Date(a.data));
}

// ---------- Ligações ----------
function saveCallLog(payload) {
  const histSheet = getOrCreateSheet(userSS(), 'Historico', ['id', 'contatoId', 'telefone', 'data', 'status', 'resumo', 'proximaData']);
  histSheet.appendRow([Utilities.getUuid(), payload.contactId, payload.telefone, payload.data, payload.status, payload.resumo, payload.proximaData]);

  const contatosSheet = userSS().getSheetByName('Contatos');
  if (contatosSheet) {
    const data = contatosSheet.getDataRange().getValues();
    const headers = data[0];
    const telCol = headers.indexOf('telefone');
    const alvo = normalizePhone(payload.telefone);
    // atualiza TODAS as linhas com o mesmo telefone (mesmo em outras listas), não só a linha atual
    for (let i = 1; i < data.length; i++) {
      if (normalizePhone(data[i][telCol]) !== alvo) continue;
      const row = i + 1;
      contatosSheet.getRange(row, headers.indexOf('status') + 1).setValue(payload.status);
      contatosSheet.getRange(row, headers.indexOf('ultimaLigacao') + 1).setValue(payload.data);
      contatosSheet.getRange(row, headers.indexOf('qtdLigacoes') + 1)
        .setValue((Number(data[i][headers.indexOf('qtdLigacoes')]) || 0) + 1);
      contatosSheet.getRange(row, headers.indexOf('proximoRetorno') + 1).setValue(payload.proximaData);
      contatosSheet.getRange(row, headers.indexOf('resumo') + 1).setValue(payload.resumo);
    }
  }

  // grava também na planilha master
  try {
    const config = getConfig();
    const masterSheet = getOrCreateSheet(masterSS(), 'Registros',
      ['usuario', 'lista', 'nome', 'telefone', 'status', 'resumo', 'data', 'proximoRetorno', 'reuniao', 'venda']);
    masterSheet.appendRow([config.nome || '', payload.listName, payload.nome, payload.telefone,
      payload.status, payload.resumo, payload.data, payload.proximaData,
      payload.status === 'Reunião agendada', payload.status === 'Venda realizada']);
  } catch (err) {
    // se a master não estiver configurada ainda, não bloqueia o salvamento local
  }

  return { ok: true };
}

// ---------- Relatórios ----------
function getReports(payload) {
  const sheet = userSS().getSheetByName('Historico');
  if (!sheet) return { ligacoes: 0, reunioes: 0, vendas: 0, conversao: 0 };
  const historico = sheetToObjects(sheet);
  const now = new Date();
  const since = { daily: 1, weekly: 7, monthly: 30 }[payload.period] || 1;
  const cutoff = new Date(now.getTime() - since * 86400000);
  const relevantes = historico.filter((h) => new Date(h.data) >= cutoff);
  const reunioes = relevantes.filter((h) => h.status === 'Reunião agendada').length;
  const vendas = relevantes.filter((h) => h.status === 'Venda realizada').length;
  const conversao = relevantes.length ? Math.round((vendas / relevantes.length) * 100) : 0;
  return { ligacoes: relevantes.length, reunioes, vendas, conversao };
}

// ---------- Conquistas ----------
function getAchievements() {
  const sheet = userSS().getSheetByName('Historico');
  const total = sheet ? sheet.getLastRow() - 1 : 0;
  const reunioes = sheet ? sheetToObjects(sheet).filter((h) => h.status === 'Reunião agendada').length : 0;
  return [
    { titulo: 'Primeira reunião', progresso: reunioes >= 1 ? 'desbloqueada' : 'bloqueada', unlocked: reunioes >= 1 },
    { titulo: '100 ligações', progresso: total >= 100 ? 'desbloqueada' : total + ' / 100', unlocked: total >= 100 },
    { titulo: '500 ligações', progresso: total >= 500 ? 'desbloqueada' : total + ' / 500', unlocked: total >= 500 },
    { titulo: '10 reuniões', progresso: reunioes >= 10 ? 'desbloqueada' : reunioes + ' / 10', unlocked: reunioes >= 10 },
  ];
}
