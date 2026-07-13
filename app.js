/**
 * app.js — navegação entre telas + lógica de cada uma.
 * Estrutura: cada <section id="scr-NOME" class="screen"> no index.html
 * é mostrada/escondida por goTo(nome). O estado do app fica em App.state.
 */

const App = {
  state: {
    config: Store.get('config') || null,
    currentList: Store.get('currentList') || null,
    currentContact: null,
    skippedIds: [],
    skippedStack: [],
    lastLogSummary: null,
  },

  init() {
    this.bindGlobalEvents();
    if (this.state.config && this.state.config.nome) {
      this.goTo('home');
      this.refreshHomeProgress();
    } else {
      this.goTo('splash');
      setTimeout(() => this.goTo('welcome'), 1600);
    }
    Store.flushQueue();
  },

  goTo(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('scr-' + name);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    const loaders = { lists: this.loadLists, dialer: this.loadDialer, reports: this.loadReports,
      achievements: this.loadAchievements, history: this.loadHistory, import: this.resetImportForm,
      settings: this.fillSettingsForm };
    if (loaders[name]) loaders[name].call(this);
  },

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  },

  bindGlobalEvents() {
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) this.goTo(g.dataset.goto);
    });

    document.getElementById('form-identification').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveIdentification(new FormData(e.target));
    });

    document.getElementById('form-import').addEventListener('submit', (e) => {
      e.preventDefault();
      this.importContacts(new FormData(e.target));
    });

    document.getElementById('import-file').addEventListener('change', (e) => this.handleFileSelect(e));

    document.getElementById('btn-call-now').addEventListener('click', () => this.startCall());
    document.getElementById('btn-skip-contact').addEventListener('click', () => this.skipContact());
    document.getElementById('btn-undo-skip').addEventListener('click', () => this.undoSkip());

    document.querySelectorAll('.status-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.status-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        document.getElementById('selected-status').value = chip.dataset.status;
      });
    });

    document.getElementById('form-log').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCallLog(new FormData(e.target));
    });

    document.querySelectorAll('.report-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('selected'));
        tab.classList.add('selected');
        this.loadReports(tab.dataset.period);
      });
    });

    document.getElementById('form-settings').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings(new FormData(e.target));
    });
  },

  // ---------- Identificação ----------
  async saveIdentification(fd) {
    const config = {
      nome: fd.get('nome'),
      metaLigacoes: Number(fd.get('metaLigacoes')),
      metaReunioes: Number(fd.get('metaReunioes')),
    };
    Store.set('config', config);
    this.state.config = config;
    try { await API.saveConfig(config); }
    catch (err) { Store.queueCall('saveConfig', config); this.toast('Salvo localmente. Sincroniza quando houver conexão.'); }
    this.goTo('home');
    this.refreshHomeProgress();
  },

  refreshHomeProgress() {
    const c = this.state.config;
    if (!c) return;
    document.getElementById('home-username').textContent = c.nome.split(' ')[0];
    document.getElementById('home-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const feitas = Store.get('callsToday') || 0;
    const reunioes = Store.get('meetingsToday') || 0;
    this.setProgress('progress-calls', feitas, c.metaLigacoes, 'calls-label');
    this.setProgress('progress-meetings', reunioes, c.metaReunioes, 'meetings-label');
  },

  setProgress(barId, done, goal, labelId) {
    const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
    document.getElementById(barId).style.width = pct + '%';
    document.getElementById(labelId).textContent = done + ' / ' + goal;
  },

  // ---------- Importação / Listas ----------
  resetImportForm() {
    this.state.fileContacts = null;
    const fileInput = document.getElementById('import-file');
    if (fileInput) fileInput.value = '';
    const info = document.getElementById('import-file-info');
    if (info) info.textContent = '';
  },

  // Normaliza texto de cabeçalho: remove acentos, espaços e deixa minúsculo
  normalizeHeader(s) {
    return (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  },

  // Converte uma matriz de linhas (array de arrays) em objetos de contato,
  // detectando automaticamente se a primeira linha é um cabeçalho reconhecível.
  parseRows(rows) {
    const known = ['nome', 'telefone', 'empresa', 'cidade', 'cargo', 'observacoes'];
    if (!rows.length) return [];
    const firstRow = rows[0].map((c) => this.normalizeHeader(c));
    const hasHeader = firstRow.includes('nome') && firstRow.includes('telefone');
    const headers = hasHeader ? firstRow : ['nome', 'telefone', 'empresa', 'cidade'];
    const dataRows = hasHeader ? rows.slice(1) : rows;
    return dataRows
      .filter((r) => r && r.length && r[0])
      .map((r) => {
        const obj = {};
        headers.forEach((h, i) => { if (known.includes(h)) obj[h] = (r[i] ?? '').toString().trim(); });
        return obj.nome && obj.telefone ? obj : null;
      })
      .filter(Boolean);
  },

  parseCSV(text) {
    const firstLine = text.split('\n')[0] || '';
    const delim = firstLine.includes(';') ? ';' : ',';
    const rows = text.trim().split('\n').map((line) => line.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
    return this.parseRows(rows);
  },

  async handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const info = document.getElementById('import-file-info');
    try {
      let contacts = [];
      if (ext === 'csv') {
        const text = await file.text();
        contacts = this.parseCSV(text);
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        contacts = this.parseRows(rows);
      }
      if (!contacts.length) {
        info.textContent = 'Não encontrei contatos válidos nesse arquivo (confira as colunas nome/telefone).';
        this.state.fileContacts = null;
        return;
      }
      this.state.fileContacts = contacts;
      info.textContent = `"${file.name}" — ${contacts.length} contatos encontrados.`;
      const listNameInput = document.querySelector('[name="listName"]');
      if (listNameInput && !listNameInput.value) listNameInput.value = file.name.replace(/\.[^.]+$/, '');
    } catch (err) {
      info.textContent = 'Não consegui ler esse arquivo. Verifique se é um CSV ou Excel válido.';
      this.state.fileContacts = null;
    }
  },

  async importContacts(fd) {
    const listName = fd.get('listName');
    let contacts = this.state.fileContacts;
    if (!contacts || !contacts.length) {
      const raw = (fd.get('rawData') || '').trim();
      if (raw) {
        contacts = raw.split('\n').filter(Boolean).map((line) => {
          const [nome, telefone, empresa = '', cidade = ''] = line.split(',').map((s) => s.trim());
          return { nome, telefone, empresa, cidade };
        });
      }
    }
    if (!contacts || !contacts.length) { this.toast('Envie um arquivo ou cole ao menos um contato.'); return; }

    const submitBtn = document.getElementById('btn-import-submit');
    const progress = document.getElementById('import-progress');
    const progressText = document.getElementById('import-progress-text');
    submitBtn.disabled = true;
    progress.style.display = 'block';
    progressText.textContent = `Importando ${contacts.length} contatos...`;

    try {
      await API.importContacts(listName, contacts);
      progressText.textContent = 'Importação concluída com sucesso!';
    } catch (err) {
      Store.queueCall('importContacts', { listName, contacts });
      progressText.textContent = 'Sem conexão — será enviado assim que possível.';
    }
    await new Promise((r) => setTimeout(r, 900));
    progress.style.display = 'none';
    submitBtn.disabled = false;
    Store.set('currentList', listName);
    this.state.currentList = listName;
    document.getElementById('summary-list-name').textContent = listName;
    document.getElementById('summary-list-count').textContent = contacts.length;
    this.goTo('summary');
  },

  async loadLists() {
    const container = document.getElementById('lists-container');
    container.innerHTML = '<p class="label">Carregando...</p>';
    try {
      const lists = await API.getLists();
      container.innerHTML = lists.map(l => `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:600;font-size:14px">${l.nome}</span>
            <span class="tag ${l.pct === 100 ? 'tag-green' : l.pct === 0 ? 'tag-gray' : 'tag-blue'}">${l.status}</span>
          </div>
          <p class="label" style="margin:6px 0 0">${l.qtd} contatos</p>
          <div class="progress"><div style="width:${l.pct}%;background:var(--blue)"></div></div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-secondary" style="padding:8px;flex:1" onclick="App.openList('${l.nome}')">abrir</button>
            <button class="btn btn-ghost" style="padding:8px;flex:0" onclick="App.renameList('${l.nome}')">renomear</button>
            <button class="btn btn-ghost" style="padding:8px;flex:0;color:var(--red)" onclick="App.deleteListPrompt('${l.nome}')">excluir</button>
          </div>
        </div>`).join('');
    } catch (err) {
      container.innerHTML = '<p class="label">Não foi possível carregar as listas agora.</p>';
    }
  },

  openList(name) {
    Store.set('currentList', name);
    this.state.currentList = name;
    document.getElementById('summary-list-name').textContent = name;
    this.goTo('summary');
  },

  async renameList(oldName) {
    const newName = prompt('Novo nome da lista:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    try {
      await API.call('renameList', { oldName, newName: newName.trim() });
      if (this.state.currentList === oldName) { this.state.currentList = newName.trim(); Store.set('currentList', newName.trim()); }
      this.toast('Lista renomeada.');
      this.loadLists();
    } catch (err) {
      this.toast('Erro: ' + err.message);
    }
  },

  async deleteListPrompt(name) {
    if (!confirm(`Excluir a lista "${name}" e todos os seus contatos? Essa ação não pode ser desfeita.`)) return;
    try {
      await API.call('deleteList', { listName: name });
      this.toast('Lista excluída.');
      this.loadLists();
    } catch (err) {
      this.toast('Erro: ' + err.message);
    }
  },

  // ---------- Discador ----------
  async loadDialer() {
    const listName = this.state.currentList;
    if (this.state.dialerListName !== listName) {
      this.state.skippedIds = [];
      this.state.skippedStack = [];
      this.state.dialerListName = listName;
    }
    const card = document.getElementById('dialer-card');
    card.innerHTML = '<p class="label">Carregando próximo contato...</p>';
    try {
      const contact = await API.getNextContact(listName, this.state.skippedIds);
      if (!contact) { card.innerHTML = '<p class="label">Lista concluída! 🎉</p>'; this.updateUndoButton(); return; }
      this.state.currentContact = contact;
      this.renderDialerCard(contact);
    } catch (err) {
      card.innerHTML = '<p class="label">Não foi possível carregar o contato. Verifique sua conexão.</p>';
    }
    this.updateUndoButton();
  },

  renderDialerCard(contact) {
    const card = document.getElementById('dialer-card');
    card.innerHTML = `
      <p style="font-size:17px;font-weight:600;margin:0">${contact.nome}</p>
      <p class="label" style="margin:2px 0 10px">${contact.empresa || ''} ${contact.cidade ? '· ' + contact.cidade : ''}</p>
      <p style="font-size:16px;font-weight:600;margin:0 0 10px">${contact.telefone}</p>
      <div style="border-top:1px solid var(--border);padding-top:10px" class="label">
        ${contact.ultimaLigacao || 'primeiro contato'} · ${contact.qtdLigacoes || 0} ligações
        ${contact.ultimoStatus ? '<span class="tag tag-orange" style="margin-left:6px">' + contact.ultimoStatus + '</span>' : ''}
      </div>
      ${contact.resumo ? '<p class="label" style="margin-top:8px">"' + contact.resumo + '"</p>' : ''}
      <button class="btn btn-ghost" style="padding:8px 0;text-align:left" data-goto="history">ver histórico completo</button>`;
    document.getElementById('btn-call-now').href = 'tel:' + contact.telefone.replace(/\D/g, '');
  },

  updateUndoButton() {
    document.getElementById('btn-undo-skip').disabled = !(this.state.skippedStack && this.state.skippedStack.length);
  },

  skipContact() {
    if (this.state.currentContact) {
      this.state.skippedIds.push(this.state.currentContact.id);
      this.state.skippedStack.push(this.state.currentContact);
    }
    this.loadDialer();
  },

  undoSkip() {
    if (!this.state.skippedStack || !this.state.skippedStack.length) return;
    const contact = this.state.skippedStack.pop();
    this.state.skippedIds = this.state.skippedIds.filter((id) => id !== contact.id);
    this.state.currentContact = contact;
    this.renderDialerCard(contact);
    this.updateUndoButton();
  },

  startCall() {
    // O href="tel:" já dispara o discador nativo do sistema (Android/iOS).
    // Ao voltar pro app (evento 'visibilitychange'), abrimos o registro automaticamente.
    const onReturn = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', onReturn);
        this.goTo('log');
      }
    };
    document.addEventListener('visibilitychange', onReturn);
  },

  // ---------- Registro da ligação ----------
  async saveCallLog(fd) {
    const contact = this.state.currentContact;
    const entry = {
      contactId: contact?.id,
      listName: this.state.currentList,
      nome: contact?.nome,
      telefone: contact?.telefone,
      status: fd.get('status'),
      resumo: fd.get('resumo'),
      proximaData: fd.get('proximaData'),
      data: new Date().toISOString(),
    };
    if (!entry.status) { this.toast('Escolha o status da ligação.'); return; }
    this.state.lastLogSummary = entry;
    try { await API.saveCallLog(entry); }
    catch (err) { Store.queueCall('saveCallLog', entry); this.toast('Salvo — será sincronizado quando houver conexão.'); }

    Store.set('callsToday', (Store.get('callsToday') || 0) + 1);
    if (entry.status === 'Reunião agendada') {
      Store.set('meetingsToday', (Store.get('meetingsToday') || 0) + 1);
    }
    this.refreshHomeProgress();
    this.renderWhatsappScreen(entry);
    this.goTo('whats');
  },

  renderWhatsappScreen(entry) {
    document.getElementById('whats-contact-name').textContent = entry.nome || '';
    document.querySelectorAll('[data-wa-template]').forEach(btn => {
      btn.onclick = () => this.sendWhatsapp(entry.telefone, btn.dataset.waTemplate);
    });
  },

  sendWhatsapp(telefone, message) {
    const phone = (telefone || '').replace(/\D/g, '');
    const url = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  },

  // ---------- Histórico ----------
  async loadHistory() {
    const container = document.getElementById('history-container');
    const contact = this.state.currentContact;
    document.getElementById('history-contact-name').textContent = contact?.nome || '';
    container.innerHTML = '<p class="label">Carregando...</p>';
    try {
      const history = await API.getContactHistory(contact?.telefone);
      container.innerHTML = history.map(h => `
        <div class="card">
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600;font-size:13px">${h.data}</span>
            <span class="tag tag-blue">${h.status}</span>
          </div>
          ${h.resumo ? '<p class="label" style="margin:6px 0 0">' + h.resumo + '</p>' : ''}
        </div>`).join('') || '<p class="label">Nenhum histórico ainda.</p>';
    } catch (err) {
      container.innerHTML = '<p class="label">Não foi possível carregar o histórico.</p>';
    }
  },

  // ---------- Relatórios ----------
  async loadReports(period = 'daily') {
    const container = document.getElementById('reports-container');
    container.innerHTML = '<p class="label">Carregando...</p>';
    try {
      const r = await API.getReports(period);
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${[['Ligações', r.ligacoes], ['Reuniões', r.reunioes], ['Vendas', r.vendas], ['Conversão', r.conversao + '%']]
            .map(m => `<div class="card" style="margin:0"><p class="label" style="margin:0">${m[0]}</p><p style="font-size:20px;font-weight:700;margin:2px 0 0">${m[1]}</p></div>`).join('')}
        </div>`;
    } catch (err) {
      container.innerHTML = '<p class="label">Não foi possível carregar os relatórios agora.</p>';
    }
  },

  // ---------- Conquistas ----------
  async loadAchievements() {
    const container = document.getElementById('achievements-container');
    container.innerHTML = '<p class="label">Carregando...</p>';
    try {
      const list = await API.getAchievements();
      container.innerHTML = list.map(a => `
        <div class="card" style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:10px;background:${a.unlocked ? '#EAF3DE' : '#F1EFE8'};display:flex;align-items:center;justify-content:center;font-size:16px">🏆</div>
          <div><p style="font-size:13px;font-weight:600;margin:0">${a.titulo}</p><p class="label" style="margin:0">${a.progresso}</p></div>
        </div>`).join('');
    } catch (err) {
      container.innerHTML = '<p class="label">Não foi possível carregar as conquistas.</p>';
    }
  },

  // ---------- Configurações ----------
  fillSettingsForm() {
    const c = this.state.config || {};
    document.getElementById('settings-nome').value = c.nome || '';
    document.getElementById('settings-script-url').value = API.getScriptUrl();
    document.getElementById('settings-meta-ligacoes').value = c.metaLigacoes || 80;
    document.getElementById('settings-meta-reunioes').value = c.metaReunioes || 5;
  },

  async saveSettings(fd) {
    API.setScriptUrl(fd.get('scriptUrl').trim());
    const config = this.state.config || {};
    config.nome = fd.get('nome').trim() || config.nome;
    config.metaLigacoes = Number(fd.get('metaLigacoes'));
    config.metaReunioes = Number(fd.get('metaReunioes'));
    Store.set('config', config);
    this.state.config = config;
    try { await API.saveConfig(config); this.toast('Configurações salvas e sincronizadas.'); }
    catch (err) { Store.queueCall('saveConfig', config); this.toast('Salvo localmente. Sincroniza quando houver conexão.'); }
    this.goTo('home');
    this.refreshHomeProgress();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}
