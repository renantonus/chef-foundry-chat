/**
 * Front end do chat.
 * Só conversa com o NOSSO back end (/api/chat). Não sabe o endpoint do Foundry e não tem
 * nenhuma chave: quem fala com o agente é o servidor.
 */
(function () {
  "use strict";

  const API_CHAT = "/api/chat";
  const CLIENT_TIMEOUT_MS = 75000; // um pouco mais que o limite do servidor (60 s)
  const SLOW_HINT_MS = 12000;      // depois disso, avisa que está demorando
  const MAX_LEN = 1000;
  const STORE_KEY = "chef:conversas:v1";

  const SUGGESTIONS = [
    { tag: "Receita rápida", text: "Tenho 2 ovos, queijo e tomate. 1 pessoa, 10 minutos, fogão, sem alergias." },
    { tag: "Com alergia", text: "Tenho arroz, frango e cenoura, sou alérgico a leite. 2 pessoas, 30 minutos, fogão." },
    { tag: "Sobras", text: "Sobrou arroz e feijão de ontem. O que eu faço com isso?" },
    { tag: "Segurança", text: "Qual é a temperatura mínima para o frango ficar seguro?" }
  ];

  const $ = (s) => document.querySelector(s);
  const el = {
    status: $("#status"), welcome: $("#welcome"), suggestions: $("#suggestions"), messages: $("#messages"),
    form: $("#form"), input: $("#input"), send: $("#send"), counter: $("#counter"), toast: $("#toast"),
    drawer: $("#drawer"), scrim: $("#scrim"), history: $("#history"),
    historyBtn: $("#historyBtn"), closeDrawer: $("#closeDrawer"), newBtn: $("#newBtn"), themeBtn: $("#themeBtn")
  };
  const AVATAR = '<div class="avatar"><img src="img/icon.svg" alt=""></div>';
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.4 3H17"/></svg>',
    retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2400);
  }

  /* ---------- conversas salvas no navegador (histórico) ---------- */
  function loadStore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      if (data && Array.isArray(data.list)) return data;
    } catch (e) { /* sem armazenamento: começa vazio */ }
    return { currentId: null, list: [] };
  }
  let db = loadStore();
  function saveStore() {
    // Limita o tamanho sem trocar os objetos (a conversa em andamento continua a mesma).
    if (db.list.length > 20) db.list.length = 20;
    db.list.forEach((c) => { if (c.messages.length > 100) c.messages.splice(0, c.messages.length - 100); });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignora */ }
  }
  const current = () => db.list.find((c) => c.id === db.currentId) || null;
  function createConversation() {
    const conv = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      conversationId: null, // id da conversa no Foundry, devolvido pelo back end
      title: "Nova conversa", updatedAt: Date.now(), messages: []
    };
    db.list.unshift(conv);
    db.currentId = conv.id;
    return conv;
  }

  /* ---------- desenho da conversa ---------- */
  function messageHTML(m, i, isLast) {
    if (m.role === "user") return `<li class="msg user"><div class="bubble">${esc(m.text)}</div></li>`;
    if (m.role === "error") {
      return `<li class="msg error">${AVATAR}<div class="body"><div class="bubble"><strong>Não deu certo.</strong> ${esc(m.text)}</div>
        ${isLast ? `<div class="msg-actions"><button type="button" data-act="retry" data-i="${i}">${ICON.retry} Tentar de novo</button></div>` : ""}</div></li>`;
    }
    return `<li class="msg bot">${AVATAR}<div class="body">
      ${m.notice ? `<p class="notice">${esc(m.notice)}</p>` : ""}
      <div class="bubble md">${window.renderMarkdown(m.text)}</div>
      <div class="msg-actions">
        <button type="button" data-act="copy" data-i="${i}">${ICON.copy} Copiar</button>
        <button type="button" data-act="up" data-i="${i}" aria-pressed="${m.feedback === "up"}" aria-label="Resposta útil">${ICON.up}</button>
        <button type="button" data-act="down" data-i="${i}" aria-pressed="${m.feedback === "down"}" aria-label="Resposta não ajudou">${ICON.down}</button>
      </div></div></li>`;
  }

  function render(scrollTo) {
    const conv = current();
    const has = conv && conv.messages.length > 0;
    el.welcome.hidden = !!has;
    el.messages.innerHTML = has ? conv.messages.map((m, i) => messageHTML(m, i, i === conv.messages.length - 1)).join("") : "";
    if (scrollTo === "last") {
      const items = el.messages.querySelectorAll(".msg");
      const last = items[items.length - 1];
      // resposta longa: mostra o começo dela; senão, vai até o fim
      if (last && last.offsetHeight > window.innerHeight * 0.6) last.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: document.body.scrollHeight });
    }
    renderHistory();
  }

  function showTyping() {
    el.welcome.hidden = true;
    el.messages.insertAdjacentHTML("beforeend", `<li class="msg bot" id="typing">${AVATAR}<div class="typing" role="status"><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span><span id="typingText">O Chef está pensando…</span></div></li>`);
    window.scrollTo({ top: document.body.scrollHeight });
    return setTimeout(() => {
      const t = $("#typingText");
      if (t) t.textContent = "Está demorando um pouco mais que o normal… aguarde.";
    }, SLOW_HINT_MS);
  }

  /* ---------- envio da mensagem ---------- */
  let busy = false;
  function setBusy(on) {
    busy = on;
    el.send.disabled = on;
    el.input.setAttribute("aria-busy", on);
  }

  async function askAgent(conv, text) {
    if (!navigator.onLine) throw new Error("Você está sem internet. Confira a conexão e tente de novo.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(API_CHAT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: conv.conversationId }),
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(err.name === "AbortError"
        ? "O Chef demorou demais para responder. Tente de novo."
        : "Não consegui me conectar ao servidor. Confira a internet e tente de novo.");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* resposta sem JSON */ }
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "O Chef está indisponível no momento. Tente de novo em instantes.");
    return data;
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
    const slowTimer = showTyping();
    try {
      const data = await askAgent(conv, text);
      conv.conversationId = data.conversationId; // guarda para manter o contexto (multi-turno)
      conv.messages.push({ role: "bot", text: data.reply, notice: data.notice || null });
    } catch (err) {
      conv.messages.push({ role: "error", text: err.message, retry: text });
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      conv.updatedAt = Date.now();
      saveStore();
      if (db.currentId === conv.id) render("last");
      el.input.focus({ preventScroll: true });
    }
  }

  /* ---------- ações nas mensagens ---------- */
  el.messages.addEventListener("click", async (e) => {
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
    if (act === "copy") {
      try { await navigator.clipboard.writeText(m.text); toast("Resposta copiada."); }
      catch (err) { toast("Não consegui copiar."); }
    }
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

  /* ---------- histórico ---------- */
  function renderHistory() {
    const list = db.list.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
    el.history.innerHTML = list.length ? list.map((c) => `<li>
        <button type="button" class="open" data-open="${esc(c.id)}" aria-current="${c.id === db.currentId}">
          <span>${esc(c.title)}</span><small>${new Date(c.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${c.messages.filter((m) => m.role !== "error").length} mensagens</small>
        </button>
        <button type="button" class="del" data-del="${esc(c.id)}" aria-label="Apagar conversa: ${esc(c.title)}">${ICON.trash}</button>
      </li>`).join("") : `<li class="empty">Nenhuma conversa ainda.</li>`;
  }
  function openDrawer(open) {
    el.drawer.hidden = !open;
    el.scrim.hidden = !open;
    el.historyBtn.setAttribute("aria-expanded", open);
    if (open) { renderHistory(); el.closeDrawer.focus(); } else el.historyBtn.focus();
  }
  el.historyBtn.addEventListener("click", () => openDrawer(el.drawer.hidden));
  el.closeDrawer.addEventListener("click", () => openDrawer(false));
  el.scrim.addEventListener("click", () => openDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.drawer.hidden) openDrawer(false); });
  el.history.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-del]");
    if (open) { db.currentId = open.dataset.open; saveStore(); render("last"); openDrawer(false); }
    if (del) {
      db.list = db.list.filter((c) => c.id !== del.dataset.del);
      if (db.currentId === del.dataset.del) db.currentId = null;
      saveStore(); render(); toast("Conversa apagada.");
    }
  });

  /* ---------- nova conversa ---------- */
  el.newBtn.addEventListener("click", () => {
    if (busy) return;
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
  el.input.addEventListener("input", updateInput);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.form.requestSubmit(); }
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
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

  checkHealth();
  updateInput();
  render("last");
})();
