/**
 * Front end do chat (núcleo).
 * Só conversa com o NOSSO back end (/api/chat/stream). Não sabe o endpoint do Foundry e não tem
 * nenhuma chave: quem fala com o agente é o servidor.
 *
 * Outros arquivos usam o que este expõe em window.Chef:
 *   montador.js  -> "Minha geladeira" (monta a mensagem com ingredientes e preferências)
 *   cozinha.js   -> timers, ditado por voz, leitura em voz alta e lista de ingredientes
 */
(function () {
  "use strict";

  const API_STREAM = "/api/chat/stream"; // resposta aos poucos
  const API_CHAT = "/api/chat";          // resposta inteira (reserva)
  const CLIENT_TIMEOUT_MS = 75000; // sem receber nada por esse tempo, desiste (o servidor espera 60 s)
  const SLOW_HINT_MS = 12000;      // depois disso, avisa que está demorando
  const MAX_LEN = 1000;
  const STORE_KEY = "chef:conversas:v1";
  const RECIPES_KEY = "chef:receitas:v1";

  const SUGGESTIONS = [
    { tag: "Receita rápida", text: "Tenho 2 ovos, queijo e tomate. 1 pessoa, 10 minutos, fogão, sem alergias." },
    { tag: "Com alergia", text: "Tenho arroz, frango e cenoura, sou alérgico a leite. 2 pessoas, 30 minutos, fogão." },
    { tag: "Sobras", text: "Sobrou arroz e feijão de ontem. O que eu faço com isso?" },
    { tag: "Segurança", text: "Qual é a temperatura mínima para o frango ficar seguro?" }
  ];
  // Respostas rápidas que aparecem depois da última mensagem do Chef.
  const QUICK_AFTER_RECIPE = ["Me dá outra opção com os mesmos ingredientes", "Tem como fazer mais rápido?", "Posso trocar algum ingrediente?", "Como guardo o que sobrar?"];
  const QUICK_AFTER_QUESTION = ["Pode assumir os valores padrão", "Sem alergias, 30 minutos, 1 pessoa, só fogão"];

  const $ = (s) => document.querySelector(s);
  const el = {
    status: $("#status"), welcome: $("#welcome"), suggestions: $("#suggestions"), messages: $("#messages"), live: $("#live"),
    form: $("#form"), input: $("#input"), send: $("#send"), counter: $("#counter"), toast: $("#toast"), quick: $("#quick"),
    drawer: $("#drawer"), scrim: $("#scrim"), history: $("#history"), saved: $("#saved"),
    tabHistory: $("#tabHistory"), tabSaved: $("#tabSaved"), panelHistory: $("#panelHistory"), panelSaved: $("#panelSaved"),
    historyBtn: $("#historyBtn"), savedBtn: $("#savedBtn"), closeDrawer: $("#closeDrawer"), exportBtn: $("#exportBtn"),
    newBtn: $("#newBtn"), themeBtn: $("#themeBtn"),
    recipeDialog: $("#recipeDialog"), recipeTitle: $("#recipeTitle"), recipeBody: $("#recipeBody"),
    recipeDelete: $("#recipeDelete"), recipeCopy: $("#recipeCopy"), recipePrint: $("#recipePrint"), printArea: $("#printArea")
  };
  const AVATAR = '<div class="avatar"><img src="img/icon.svg" alt=""></div>';
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    speak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.4 3H17"/></svg>',
    retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2400);
  }
  /** Erro com mensagem já pronta para mostrar ao usuário. */
  function friendly(message, extra) { return Object.assign(new Error(message), { friendly: true }, extra); }
  /** Tira a marcação do markdown (para copiar como título, ler em voz alta etc.). */
  function plainText(md) {
    return String(md || "").replace(/```[\s\S]*?```/g, " ").replace(/^\s*#{1,6}\s+/gm, "").replace(/\*\*|__|`/g, "").replace(/^\s*[-*•]\s+/gm, "").trim();
  }
  async function copyText(text, okMessage) {
    try { await navigator.clipboard.writeText(text); toast(okMessage); }
    catch (err) { toast("Não consegui copiar."); }
  }

  /* ---------- conversas salvas no navegador (histórico) ---------- */
  function loadJson(key, fallback, check) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (check(data)) return data;
    } catch (e) { /* sem armazenamento: começa vazio */ }
    return fallback;
  }
  let db = loadJson(STORE_KEY, { currentId: null, list: [] }, (d) => d && Array.isArray(d.list));
  function saveStore() {
    // Limita o tamanho sem trocar os objetos (a conversa em andamento continua a mesma).
    if (db.list.length > 20) db.list.length = 20;
    db.list.forEach((c) => { if (c.messages.length > 100) c.messages.splice(0, c.messages.length - 100); });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignora */ }
  }
  const current = () => db.list.find((c) => c.id === db.currentId) || null;
  const newId = () => ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  function createConversation() {
    const conv = {
      id: newId(),
      conversationId: null, // id da conversa no Foundry, devolvido pelo back end
      title: "Nova conversa", updatedAt: Date.now(), messages: []
    };
    db.list.unshift(conv);
    db.currentId = conv.id;
    return conv;
  }

  /* ---------- receitas salvas (favoritos) ---------- */
  let recipes = loadJson(RECIPES_KEY, [], Array.isArray);
  function saveRecipes() {
    if (recipes.length > 50) recipes.length = 50;
    try { localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes)); } catch (e) { /* ignora */ }
  }
  /** Título da receita: a primeira linha "de verdade" da resposta (pula avisos). */
  function recipeTitle(text) {
    const lines = plainText(text).split("\n").map((l) => l.trim()).filter(Boolean);
    const line = lines.find((l) => !/^aviso|^atenção|^ótimo|^certo|^beleza/i.test(l) && l.length <= 90) || lines[0] || "Receita";
    const clean = line.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[:.]$/, "");
    return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
  }
  const isSaved = (m) => !!m.savedId && recipes.some((r) => r.id === m.savedId);

  /* ---------- desenho da conversa ---------- */
  function messageHTML(m, i, isLast) {
    if (m.role === "user") return `<li class="msg user"><div class="bubble">${esc(m.text)}</div></li>`;
    if (m.role === "error") {
      return `<li class="msg error">${AVATAR}<div class="body"><div class="bubble"><strong>Não deu certo.</strong> ${esc(m.text)}</div>
        ${isLast ? `<div class="msg-actions"><button type="button" data-act="retry" data-i="${i}">${ICON.retry} Tentar de novo</button></div>` : ""}</div></li>`;
    }
    const saved = isSaved(m);
    return `<li class="msg bot">${AVATAR}<div class="body">
      ${m.notice ? `<p class="notice">${esc(m.notice)}</p>` : ""}
      <div class="bubble md" data-i="${i}">${decorate(window.renderMarkdown(m.text))}</div>
      <div class="msg-actions">
        <button type="button" data-act="copy" data-i="${i}">${ICON.copy} Copiar</button>
        <button type="button" data-act="save" data-i="${i}" aria-pressed="${saved}">${ICON.star} ${saved ? "Salva" : "Salvar"}</button>
        <button type="button" data-act="speak" data-i="${i}" aria-label="Ouvir a resposta" title="Ouvir">${ICON.speak}</button>
        <button type="button" data-act="share" data-i="${i}" aria-label="Compartilhar" title="Compartilhar">${ICON.share}</button>
        <button type="button" data-act="print" data-i="${i}" aria-label="Imprimir" title="Imprimir">${ICON.print}</button>
        <button type="button" data-act="up" data-i="${i}" aria-pressed="${m.feedback === "up"}" aria-label="Resposta útil" title="Resposta útil">${ICON.up}</button>
        <button type="button" data-act="down" data-i="${i}" aria-pressed="${m.feedback === "down"}" aria-label="Resposta não ajudou" title="Não ajudou">${ICON.down}</button>
      </div></div></li>`;
  }
  /** cozinha.js pode enfeitar o HTML da resposta (botões de timer). Sem ele, fica como está. */
  function decorate(html) { return window.Chef && window.Chef.decorate ? window.Chef.decorate(html) : html; }

  const nearBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const toBottom = () => window.scrollTo({ top: document.body.scrollHeight });

  function render(scrollTo) {
    const conv = current();
    const has = conv && conv.messages.length > 0;
    el.welcome.hidden = !!has;
    el.messages.innerHTML = has ? conv.messages.map((m, i) => messageHTML(m, i, i === conv.messages.length - 1)).join("") : "";
    renderQuick();
    if (scrollTo === "last" && has) {
      const items = el.messages.querySelectorAll(".msg");
      const last = items[items.length - 1];
      // resposta longa: mostra o começo dela; senão, vai até o fim
      if (last && last.offsetHeight > window.innerHeight * 0.6) last.scrollIntoView({ block: "start" });
      else toBottom();
    }
    renderHistory();
    renderSaved();
  }

  /** Respostas rápidas: aparecem conforme a última mensagem do Chef (receita ou pergunta). */
  function renderQuick() {
    const conv = current();
    const last = conv && conv.messages[conv.messages.length - 1];
    let options = [];
    if (!busy && last && last.role === "bot") {
      if (/modo de preparo|ingredientes\s*:/i.test(last.text)) options = QUICK_AFTER_RECIPE;
      else if (last.text.includes("?")) options = QUICK_AFTER_QUESTION;
    }
    el.quick.innerHTML = options.map((t) => `<button type="button" data-say="${esc(t)}">${esc(t)}</button>`).join("");
    el.quick.hidden = !options.length;
  }
  el.quick.addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) send(b.dataset.say); });

  /** Bolha provisória enquanto o Chef pensa e escreve. Devolve funções para atualizar e remover. */
  function showPending() {
    el.welcome.hidden = true;
    el.messages.insertAdjacentHTML("beforeend", `<li class="msg bot" id="pending">${AVATAR}<div class="body">
      <div class="typing" role="status"><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span><span id="typingText">O Chef está pensando…</span></div></div></li>`);
    toBottom();
    const node = $("#pending");
    const slow = setTimeout(() => {
      const t = $("#typingText");
      if (t) t.textContent = "Está demorando um pouco mais que o normal… aguarde.";
    }, SLOW_HINT_MS);
    let text = "";
    let frame = 0;
    return {
      get text() { return text; },
      /** Acrescenta um pedaço de texto e redesenha (no máximo uma vez por quadro). */
      append(piece) {
        text += piece;
        clearTimeout(slow);
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const stick = nearBottom();
          node.querySelector(".body").innerHTML = `<div class="bubble md streaming">${window.renderMarkdown(text)}</div>`;
          if (stick) toBottom();
        });
      },
      remove() { clearTimeout(slow); cancelAnimationFrame(frame); node.remove(); }
    };
  }

  /* ---------- envio da mensagem ---------- */
  let busy = false;
  let activeRequest = null; // AbortController da resposta em andamento (para o botão "Parar")
  function setBusy(on) {
    busy = on;
    el.input.setAttribute("aria-busy", on);
    // Enquanto o Chef responde, o botão de enviar vira "Parar".
    el.send.innerHTML = on ? ICON.stop : ICON.send;
    el.send.classList.toggle("stop", on);
    el.send.setAttribute("aria-label", on ? "Parar a resposta" : "Enviar mensagem");
    renderQuick();
  }

  /**
   * Pede a resposta ao back end. Chama onDelta(pedaço) a cada trecho recebido.
   * `state` guarda o que já se sabe (id da conversa), mesmo se a resposta for interrompida.
   */
  async function askAgent(conv, text, onDelta, controller, state) {
    if (!navigator.onLine) throw friendly("Você está sem internet. Confira a conexão e tente de novo.");
    let timedOut = false;
    let idle;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; controller.abort(); }, CLIENT_TIMEOUT_MS); };
    const request = (url) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, conversationId: conv.conversationId }),
      signal: controller.signal
    });
    arm();
    try {
      let res = await request(API_STREAM);
      if (res.status === 404) res = await request(API_CHAT); // servidor sem streaming

      // Resposta comum em JSON: erro, ou a resposta inteira de uma vez.
      if (!(res.headers.get("content-type") || "").includes("ndjson")) {
        let data = null;
        try { data = await res.json(); } catch (e) { /* resposta sem JSON */ }
        if (!res.ok || !data) throw friendly((data && data.error && data.error.message) || "O Chef está indisponível no momento. Tente de novo em instantes.");
        state.conversationId = data.conversationId;
        onDelta(data.reply);
        return data;
      }

      // Streaming: uma linha de JSON por evento (meta, delta, done ou error).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = null;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        arm();
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "meta") state.conversationId = ev.conversationId;
          else if (ev.type === "delta") onDelta(ev.text);
          else if (ev.type === "done") done = ev;
          else if (ev.type === "error") throw friendly(ev.message);
        }
      }
      if (!done) throw friendly("A resposta foi interrompida no meio. Tente de novo.");
      state.conversationId = done.conversationId;
      return done;
    } catch (err) {
      if (err.friendly) throw err;
      if (err.name === "AbortError") {
        if (timedOut) throw friendly("O Chef demorou demais para responder. Tente de novo.");
        throw friendly("Resposta interrompida.", { stopped: true });
      }
      throw friendly("Não consegui me conectar ao servidor. Confira a internet e tente de novo.");
    } finally {
      clearTimeout(idle);
    }
  }

  async function send(raw) {
    const text = String(raw || "").trim();
    if (busy || !text) return;
    if (text.length > MAX_LEN) { toast(`A mensagem passou de ${MAX_LEN} caracteres.`); return; }
    const conv = current() || createConversation();
    conv.messages.push({ role: "user", text });
    if (conv.title === "Nova conversa") conv.title = text.length > 60 ? text.slice(0, 57) + "…" : text;
    conv.updatedAt = Date.now();
    saveStore();
    render("last");
    setBusy(true);
    const pending = showPending();
    const state = { conversationId: conv.conversationId };
    activeRequest = new AbortController();
    try {
      const data = await askAgent(conv, text, (piece) => pending.append(piece), activeRequest, state);
      conv.messages.push({ role: "bot", text: data.reply, notice: data.notice || null });
      el.live.textContent = "O Chef respondeu.";
    } catch (err) {
      const partial = pending.text.trim();
      if (err.stopped && partial) conv.messages.push({ role: "bot", text: partial, notice: "Resposta interrompida por você." });
      else if (err.stopped) toast("Resposta interrompida.");
      else conv.messages.push({ role: "error", text: err.message, retry: text });
    } finally {
      if (state.conversationId) conv.conversationId = state.conversationId; // mantém o contexto (multi-turno)
      activeRequest = null;
      pending.remove();
      setBusy(false);
      conv.updatedAt = Date.now();
      saveStore();
      if (db.currentId === conv.id) render("last");
      el.input.focus({ preventScroll: true });
    }
  }

  /* ---------- ações nas mensagens ---------- */
  function printRecipe(text) {
    el.printArea.innerHTML = `<h1>Chef de Geladeira Vazia</h1>${window.renderMarkdown(text)}`;
    window.print();
  }
  async function shareText(text) {
    const title = recipeTitle(text);
    if (navigator.share) {
      try { await navigator.share({ title, text: plainText(text) }); } catch (err) { /* a pessoa cancelou */ }
    } else {
      copyText(plainText(text), "Copiei o texto para você colar onde quiser.");
    }
  }
  function toggleSaved(m) {
    if (isSaved(m)) {
      recipes = recipes.filter((r) => r.id !== m.savedId);
      m.savedId = null;
      toast("Receita removida das salvas.");
    } else {
      m.savedId = newId();
      recipes.unshift({ id: m.savedId, title: recipeTitle(m.text), text: m.text, savedAt: Date.now() });
      toast("Receita salva. Veja em Receitas.");
    }
    saveRecipes();
    saveStore();
    render();
  }

  el.messages.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const conv = current();
    const i = Number(btn.dataset.i);
    const m = conv && conv.messages[i];
    if (!m) return;
    const act = btn.dataset.act;
    if (act === "retry") {
      conv.messages.splice(i - 1, 2); // tira a pergunta e o erro; a pergunta volta a ser enviada
      saveStore();
      send(m.retry);
    }
    if (act === "copy") copyText(m.text, "Resposta copiada.");
    if (act === "save") toggleSaved(m);
    if (act === "share") shareText(m.text);
    if (act === "print") printRecipe(m.text);
    if (act === "speak" && window.Chef.speak) window.Chef.speak(plainText(m.text), btn);
    if (act === "up" || act === "down") {
      m.feedback = m.feedback === act ? null : act;
      saveStore();
      render();
      if (m.feedback) {
        toast("Obrigado pelo retorno!");
        fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: act }) }).catch(() => {});
      }
    }
  });

  /* ---------- painel lateral: conversas e receitas salvas ---------- */
  const when = (t) => new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  function renderHistory() {
    const list = db.list.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
    el.history.innerHTML = list.length ? list.map((c) => `<li>
        <button type="button" class="open" data-open="${esc(c.id)}" aria-current="${c.id === db.currentId}">
          <span>${esc(c.title)}</span><small>${when(c.updatedAt)} · ${c.messages.filter((m) => m.role !== "error").length} mensagens</small>
        </button>
        <button type="button" class="del" data-del="${esc(c.id)}" aria-label="Apagar conversa: ${esc(c.title)}">${ICON.trash}</button>
      </li>`).join("") : `<li class="empty">Nenhuma conversa ainda.</li>`;
    const conv = current();
    el.exportBtn.hidden = !(conv && conv.messages.length);
  }
  function renderSaved() {
    el.saved.innerHTML = recipes.length ? recipes.map((r) => `<li>
        <button type="button" class="open" data-recipe="${esc(r.id)}"><span>${esc(r.title)}</span><small>Salva em ${when(r.savedAt)}</small></button>
        <button type="button" class="del" data-del-recipe="${esc(r.id)}" aria-label="Apagar receita: ${esc(r.title)}">${ICON.trash}</button>
      </li>`).join("") : `<li class="empty">Nenhuma receita salva. Toque em “Salvar” embaixo de uma resposta do Chef.</li>`;
  }
  function showTab(name) {
    const saved = name === "saved";
    el.tabHistory.setAttribute("aria-selected", !saved);
    el.tabSaved.setAttribute("aria-selected", saved);
    el.panelHistory.hidden = saved;
    el.panelSaved.hidden = !saved;
  }
  function openDrawer(open, tab) {
    el.drawer.hidden = !open;
    el.scrim.hidden = !open;
    el.historyBtn.setAttribute("aria-expanded", open);
    if (open) { showTab(tab || "history"); renderHistory(); renderSaved(); el.closeDrawer.focus(); }
  }
  el.historyBtn.addEventListener("click", () => openDrawer(true, "history"));
  el.savedBtn.addEventListener("click", () => openDrawer(true, "saved"));
  el.tabHistory.addEventListener("click", () => showTab("history"));
  el.tabSaved.addEventListener("click", () => showTab("saved"));
  el.closeDrawer.addEventListener("click", () => openDrawer(false));
  el.scrim.addEventListener("click", () => openDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.drawer.hidden) openDrawer(false); });
  el.history.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-del]");
    if (open) {
      if (busy) { toast("Espere o Chef terminar de responder."); return; }
      db.currentId = open.dataset.open; saveStore(); render("last"); openDrawer(false);
    }
    if (del) {
      if (busy && del.dataset.del === db.currentId) { toast("Espere o Chef terminar de responder."); return; }
      db.list = db.list.filter((c) => c.id !== del.dataset.del);
      if (db.currentId === del.dataset.del) db.currentId = null;
      saveStore(); render(); toast("Conversa apagada.");
    }
  });

  /* receita salva aberta */
  let openRecipeId = null;
  function removeRecipe(id) {
    recipes = recipes.filter((r) => r.id !== id);
    saveRecipes();
    render();
    toast("Receita apagada.");
  }
  el.saved.addEventListener("click", (e) => {
    const open = e.target.closest("[data-recipe]");
    const del = e.target.closest("[data-del-recipe]");
    if (del) removeRecipe(del.dataset.delRecipe);
    if (open) {
      const r = recipes.find((x) => x.id === open.dataset.recipe);
      if (!r) return;
      openRecipeId = r.id;
      el.recipeTitle.textContent = r.title;
      el.recipeBody.innerHTML = decorate(window.renderMarkdown(r.text));
      el.recipeDialog.showModal();
    }
  });
  const openRecipe = () => recipes.find((r) => r.id === openRecipeId);
  el.recipeCopy.addEventListener("click", () => { const r = openRecipe(); if (r) copyText(r.text, "Receita copiada."); });
  el.recipePrint.addEventListener("click", () => { const r = openRecipe(); if (r) printRecipe(r.text); });
  el.recipeDelete.addEventListener("click", () => { if (openRecipeId) removeRecipe(openRecipeId); el.recipeDialog.close(); });

  /* baixar a conversa atual como texto */
  el.exportBtn.addEventListener("click", () => {
    const conv = current();
    if (!conv || !conv.messages.length) return;
    const lines = conv.messages.filter((m) => m.role !== "error").map((m) => `${m.role === "user" ? "Você" : "Chef"}:\n${m.role === "user" ? m.text : plainText(m.text)}\n`);
    const blob = new Blob([`Chef de Geladeira Vazia\n${when(conv.updatedAt)}\n\n${lines.join("\n")}`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "conversa-com-o-chef.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* ---------- nova conversa ---------- */
  el.newBtn.addEventListener("click", () => {
    if (busy) { toast("Espere o Chef terminar de responder."); return; }
    db.currentId = null; // a próxima mensagem cria uma conversa nova no Foundry
    saveStore();
    render();
    window.scrollTo({ top: 0 });
    el.input.focus();
    toast("Nova conversa iniciada.");
  });

  /* ---------- caixa de texto ---------- */
  function updateInput() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(180, el.input.scrollHeight) + "px";
    const n = el.input.value.length;
    el.counter.textContent = `${n}/${MAX_LEN}`;
    el.counter.classList.toggle("over", n >= MAX_LEN);
  }
  function setInput(text) {
    el.input.value = String(text).slice(0, MAX_LEN);
    updateInput();
    el.input.focus();
  }
  el.input.addEventListener("input", updateInput);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.form.requestSubmit(); }
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) { if (activeRequest) activeRequest.abort(); return; } // botão "Parar"
    const v = el.input.value;
    el.input.value = "";
    updateInput();
    send(v);
  });

  /* ---------- sugestões iniciais ---------- */
  el.suggestions.innerHTML = SUGGESTIONS.map((s) => `<button type="button" class="suggestion" data-say="${esc(s.text)}"><b>${esc(s.tag)}</b>${esc(s.text)}</button>`).join("");
  el.suggestions.addEventListener("click", (e) => { const b = e.target.closest("[data-say]"); if (b) send(b.dataset.say); });

  /* ---------- tema ---------- */
  function isDark() {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function paintThemeButton() { el.themeBtn.innerHTML = isDark() ? ICON.sun : ICON.moon; }
  el.themeBtn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("chef:theme", next); } catch (e) { /* ignora */ }
    paintThemeButton();
  });
  paintThemeButton();

  /* ---------- situação do servidor ---------- */
  async function checkHealth() {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      if (data.configured) {
        el.status.className = "status ok";
        el.status.innerHTML = `<span class="dot"></span> Agente ${esc(data.agent)} · Microsoft Foundry`;
      } else {
        el.status.className = "status warn";
        el.status.innerHTML = '<span class="dot"></span> Servidor sem configuração (.env)';
      }
    } catch (e) {
      el.status.className = "status warn";
      el.status.innerHTML = '<span class="dot"></span> Servidor fora do ar';
    }
  }
  window.addEventListener("online", checkHealth);
  window.addEventListener("offline", () => { el.status.className = "status warn"; el.status.innerHTML = '<span class="dot"></span> Sem internet'; });

  // O que os outros arquivos (montador.js e cozinha.js) podem usar.
  window.Chef = { send, setInput, toast, esc, isBusy: () => busy, rerender: () => render() };

  checkHealth();
  updateInput();
  render("last");
})();
