# Prospecta — CRM de Prospecção com Discador

PWA instalável em Android e iPhone, com TWA (app Android real) opcional. Backend em Google Apps Script + Google Sheets.

## 1. Google Sheets (backend)

1. Crie uma planilha nova no Google Sheets — ela vai ser a **planilha do usuário** (cada vendedor pode ter a sua, ou todos usam a mesma pra começar).
2. Crie uma segunda planilha em branco — essa é a **planilha master**, que recebe os registros de todos os vendedores. Copie o **ID dela** (o trecho da URL entre `/d/` e `/edit`).
3. Na planilha do usuário, vá em **Extensões > Apps Script**.
4. Apague o conteúdo padrão e cole o conteúdo de `apps-script/Code.gs`.
5. No topo do código, troque `COLE_AQUI_O_ID_DA_PLANILHA_MASTER` pelo ID da planilha master.
6. Clique em **Implantar > Nova implantação**:
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
7. Copie a URL gerada (termina em `/exec`) — você vai colar essa URL dentro do app, na tela **Configurações**.

As abas `Contatos`, `Historico` e `Config` são criadas automaticamente na primeira vez que o app grava dados — não precisa criar manualmente.

## 2. Publicar o app no GitHub Pages

1. Crie um repositório novo no GitHub e suba todos os arquivos desta pasta (`index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js`, `icons/`).
2. Em **Settings > Pages**, defina a branch `main` e a pasta `/root` como fonte.
3. Em poucos minutos o app estará em `https://SEU_USUARIO.github.io/SEU_REPO/`.
4. Abra a URL, vá em **Configurações** e cole a URL do Apps Script (`.../exec`).

## 3. Instalar no iPhone (PWA — não existe TWA no iOS)

1. Abra a URL do GitHub Pages no Safari.
2. Toque em **Compartilhar > Adicionar à Tela de Início**.
3. O app passa a abrir em tela cheia, como um app nativo.

Limitações do iOS (já previstas na especificação): o app abre o discador nativo via link `tel:`, mas não tem acesso à duração da chamada nem controla o encerramento — isso é uma restrição do sistema, não do app.

## 4. Gerar o APK Android (TWA)

TWA (Trusted Web Activity) empacota o PWA num app Android real usando o Chrome. Duas formas:

- **PWABuilder (mais simples):** acesse [pwabuilder.com](https://www.pwabuilder.com), cole a URL do GitHub Pages, gere o pacote Android e baixe o APK/AAB pronto pra subir na Play Store.
- **Bubblewrap (linha de comando, mais controle):**
  ```
  npm install -g @bubblewrap/cli
  bubblewrap init --manifest https://SEU_USUARIO.github.io/SEU_REPO/manifest.json
  bubblewrap build
  ```

## 5. Estrutura de arquivos

```
index.html          → todas as telas (splash até configurações)
css/style.css        → identidade visual (cores, tipografia, componentes)
js/api.js            → comunicação com o Apps Script (com fila offline)
js/app.js            → navegação e lógica de cada tela
manifest.json         → configuração do PWA
service-worker.js     → cache do app shell (funciona offline)
icons/                → ícones do app (troque pelos definitivos)
apps-script/Code.gs    → backend (planilha do usuário + master)
```

## 6. Sobre a comunicação com o Apps Script (CORS)

O `api.js` envia as requisições com `Content-Type: text/plain` de propósito — isso evita o "preflight" (OPTIONS) que o Apps Script não trata bem. Se você notar erros de CORS no console, confirme que a implantação está com acesso **"Qualquer pessoa"** e que é uma implantação **nova** (editar o código não atualiza a URL — é preciso gerenciar implantações e publicar uma nova versão).

## 7. Próximos passos sugeridos

- Substituir os ícones placeholder pela logo real (192px, 512px e uma versão "maskable" com margem de segurança).
- Testar o fluxo completo: identificação → importar lista (por upload de CSV/Excel ou colando texto) → discar → registrar → WhatsApp.
- A leitura de arquivos Excel depende da biblioteca SheetJS carregada via CDN (`cdnjs.cloudflare.com`) — funciona normalmente com internet, mas não funciona 100% offline na primeira vez que o app carrega (depois de aberto uma vez, o navegador já guarda em cache).
- Configurar as notificações (08h/13h/17h) — hoje não implementadas, dependem de push notification (Web Push funciona no Android; no iOS só a partir da versão 16.4+, e exige o app instalado na tela de início).
