/**
 * Ajudas para a hora de cozinhar:
 *  1. Timers: os tempos da receita ("5 minutos") viram botões que iniciam uma contagem regressiva.
 *  2. Lista de ingredientes: tocar num item risca o que já foi separado.
 *  3. Ouvir: lê a resposta em voz alta (síntese de voz do navegador).
 *  4. Ditado: escreve a mensagem pela voz (reconhecimento de fala do navegador, quando existe).
 * Tudo roda no navegador; nada disso passa pelo servidor.
 */
(function () {
  "use strict";
  const Chef = window.Chef;
  const $ = (s) => document.querySelector(s);

  /* ---------- 1. timers ---------- */
  const dock = $("#timers");
  const timers = []; // { id, label, total, endsAt, done }
  let tick = null;
  let nextId = 1;

  // "5 minutos", "10 min", "1 hora", "2 h": vira um botão de timer.
  const TIME_RE = /(\d{1,3})\s?(minutos?|min|horas?|h)(?![\p{L}\d])/giu;
  /** Troca os tempos do texto por botões. Recebe e devolve HTML já seguro (vindo do markdown). */
  Chef.decorate = function (html) {
    return html.replace(TIME_RE, (match, n, unit) => {
      const minutes = /^h/i.test(unit) ? Number(n) * 60 : Number(n);
      if (!minutes || minutes > 600) return match;
      return `<button type="button" class="timer-chip" data-min="${minutes}" title="Iniciar timer de ${match}">${match}</button>`;
    });
  };

  const clock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  /** Três bipes curtos quando o timer termina (sem arquivo de som). */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [0, 0.35, 0.7].forEach((start) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.2);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch (e) { /* sem áudio: fica só o aviso na tela */ }
  }

  function renderTimers() {
    dock.innerHTML = timers.map((t) => `<div class="timer${t.done ? " done" : ""}" data-id="${t.id}">
        <span class="timer-label">${Chef.esc(t.label)}</span>
        <strong class="timer-clock">${t.done ? "Pronto!" : clock(t.endsAt - Date.now())}</strong>
        <progress max="${t.total}" value="${t.done ? t.total : t.total - Math.max(0, t.endsAt - Date.now())}"></progress>
        <button type="button" data-cancel="${t.id}" aria-label="${t.done ? "Fechar" : "Cancelar"} timer de ${Chef.esc(t.label)}">✕</button>
      </div>`).join("");
    document.body.classList.toggle("has-timers", timers.length > 0);
  }

  function update() {
    const now = Date.now();
    timers.forEach((t) => {
      if (!t.done && now >= t.endsAt) {
        t.done = true;
        beep();
        Chef.toast(`Timer de ${t.label} terminou!`);
      }
    });
    renderTimers();
    if (!timers.some((t) => !t.done)) { clearInterval(tick); tick = null; }
  }

  function startTimer(minutes) {
    if (timers.length >= 4) { Chef.toast("Já tem 4 timers rodando."); return; }
    const total = minutes * 60000;
    const label = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
    timers.push({ id: nextId++, label, total, endsAt: Date.now() + total, done: false });
    Chef.toast(`Timer de ${label} iniciado.`);
    renderTimers();
    if (!tick) tick = setInterval(update, 500);
  }

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".timer-chip");
    if (chip) { startTimer(Number(chip.dataset.min)); return; }
    const cancel = e.target.closest("[data-cancel]");
    if (cancel) {
      const i = timers.findIndex((t) => t.id === Number(cancel.dataset.cancel));
      if (i !== -1) timers.splice(i, 1);
      renderTimers();
      return;
    }
    /* ---------- 2. riscar ingredientes já separados ---------- */
    const item = e.target.closest(".md ul > li");
    if (item && !e.target.closest("button, a")) item.classList.toggle("done");
  });

  // Com um timer rodando, avisa antes de fechar a página.
  window.addEventListener("beforeunload", (e) => {
    if (timers.some((t) => !t.done)) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- 3. ouvir a resposta ---------- */
  const synth = window.speechSynthesis;
  let speakingBtn = null;
  function stopSpeaking() {
    if (synth) synth.cancel();
    if (speakingBtn) speakingBtn.setAttribute("aria-pressed", "false");
    speakingBtn = null;
  }
  Chef.speak = function (text, btn) {
    if (!synth || !window.SpeechSynthesisUtterance) { Chef.toast("Este navegador não lê em voz alta."); return; }
    const wasThis = speakingBtn === btn;
    stopSpeaking();
    if (wasThis) return; // segundo toque no mesmo botão: só para
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    const voice = synth.getVoices().find((v) => /^pt[-_]BR/i.test(v.lang)) || synth.getVoices().find((v) => /^pt/i.test(v.lang));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { if (speakingBtn === btn) stopSpeaking(); };
    speakingBtn = btn;
    btn.setAttribute("aria-pressed", "true");
    synth.speak(u);
  };
  window.addEventListener("pagehide", stopSpeaking);

  /* ---------- 4. ditado por voz ---------- */
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $("#micBtn");
  const input = $("#input");
  if (Recognition && micBtn) {
    micBtn.hidden = false;
    let rec = null;
    let base = "";
    const stop = () => { if (rec) rec.stop(); };
    micBtn.addEventListener("click", () => {
      if (rec) { stop(); return; }
      rec = new Recognition();
      rec.lang = "pt-BR";
      rec.interimResults = true;
      rec.continuous = false;
      base = input.value ? input.value.trimEnd() + " " : "";
      rec.onresult = (ev) => {
        let said = "";
        for (const result of ev.results) said += result[0].transcript;
        Chef.setInput(base + said);
      };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") Chef.toast("Permita o uso do microfone para ditar.");
        else if (ev.error !== "aborted" && ev.error !== "no-speech") Chef.toast("Não consegui ouvir. Tente de novo.");
      };
      rec.onend = () => { rec = null; micBtn.setAttribute("aria-pressed", "false"); };
      micBtn.setAttribute("aria-pressed", "true");
      try { rec.start(); Chef.toast("Pode falar os ingredientes…"); } catch (e) { rec = null; micBtn.setAttribute("aria-pressed", "false"); }
    });
  }

  // As respostas já desenhadas antes deste arquivo carregar ganham os botões de timer.
  Chef.rerender();
})();
