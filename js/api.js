/**
 * api.js
 * Camada de comunicação com o backend (Google Apps Script + Google Sheets).
 *
 * IMPORTANTE SOBRE CORS:
 * Web Apps do Google Apps Script não lidam bem com o "preflight" (OPTIONS) que
 * o navegador dispara automaticamente em requisições POST com Content-Type: application/json.
 * Para evitar isso, enviamos o corpo como "text/plain" (o que o navegador trata como
 * "requisição simples", sem preflight) e no Code.gs fazemos JSON.parse(e.postData.contents).
 */

const API = (() => {
  // Cole aqui a URL do seu Web App depois de publicar o Code.gs (Implantar > Nova implantação > App da Web)
  const SCRIPT_URL = localStorage.getItem('prospecta_script_url') || '';

  function setScriptUrl(url) {
    localStorage.setItem('prospecta_script_url', url);
  }

  function getScriptUrl() {
    return localStorage.getItem('prospecta_script_url') || SCRIPT_URL;
  }

  async function call(action, payload = {}) {
    const url = getScriptUrl();
    if (!url) {
      throw new Error('URL do Apps Script não configurada. Defina em Configurações.');
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, token: Store.get('token') || '' }),
    });
    if (!res.ok) throw new Error('Falha na comunicação com a planilha (' + res.status + ')');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  return {
    setScriptUrl,
    getScriptUrl,
    call,

    // --- Configuração / login do vendedor ---
    saveConfig: (config) => call('saveConfig', config),
    getConfig: () => call('getConfig'),

    // --- Contatos e listas ---
    importContacts: (listName, contacts) => call('importContacts', { listName, contacts }),
    getLists: () => call('getLists'),
    getListContacts: (listName) => call('getListContacts', { listName }),
    getNextContact: (listName, excludeIds = []) => call('getNextContact', { listName, excludeIds }),
    getContactHistory: (telefone) => call('getContactHistory', { telefone }),

    // --- Ligações ---
    saveCallLog: (entry) => call('saveCallLog', entry),

    // --- Relatórios ---
    getReports: (period) => call('getReports', { period }), // period: 'daily' | 'weekly' | 'monthly'

    // --- Conquistas (calculadas a partir do histórico no backend) ---
    getAchievements: () => call('getAchievements'),
  };
})();

/**
 * Store: cache local simples (localStorage) para funcionar offline-first.
 * Toda escrita tenta ir pro Sheets; se falhar (sem internet), fica numa fila
 * local e é reenviada quando a conexão voltar.
 */
const Store = (() => {
  const get = (key) => {
    try { return JSON.parse(localStorage.getItem('prospecta_' + key)); }
    catch { return null; }
  };
  const set = (key, value) => localStorage.setItem('prospecta_' + key, JSON.stringify(value));

  const queueCall = (action, payload) => {
    const queue = get('queue') || [];
    queue.push({ action, payload, ts: Date.now() });
    set('queue', queue);
  };

  const flushQueue = async () => {
    const queue = get('queue') || [];
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try { await API.call(item.action, item.payload); }
      catch { remaining.push(item); }
    }
    set('queue', remaining);
  };

  window.addEventListener('online', flushQueue);

  return { get, set, queueCall, flushQueue };
})();
