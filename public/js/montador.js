/**
 * "Minha geladeira": monta a mensagem para o Chef a partir de ingredientes clicáveis e preferências
 * (pessoas, tempo, utensílios, restrições e alergias). Assim o Chef já recebe tudo de uma vez e
 * não precisa perguntar antes de montar a receita. As escolhas ficam salvas só neste navegador.
 */
(function () {
  "use strict";

  const KEY = "chef:geladeira:v1";
  const MAX_LEN = 1000;
  const GROUPS = [
    { name: "Básicos", items: ["arroz", "feijão", "macarrão", "pão", "ovo", "batata", "farinha de trigo", "fubá", "aveia"] },
    { name: "Carnes e proteínas", items: ["frango", "carne moída", "linguiça", "salsicha", "atum em lata", "sardinha em lata", "presunto", "queijo"] },
    { name: "Legumes e verduras", items: ["tomate", "cebola", "alho", "cenoura", "abobrinha", "chuchu", "couve", "alface", "milho", "ervilha"] },
    { name: "Geladeira e despensa", items: ["leite", "manteiga", "requeijão", "creme de leite", "molho de tomate", "maionese", "açúcar"] },
    { name: "Frutas", items: ["banana", "maçã", "limão", "laranja"] }
  ];
  const TIMES = [10, 20, 30, 60];
  const TOOLS = ["fogão", "forno", "micro-ondas", "air fryer"];
  const DIETS = ["vegetariano", "vegano", "sem lactose", "sem glúten"];

  const $ = (s) => document.querySelector(s);
  const dialog = $("#fridgeDialog");
  if (!dialog) return;
  const el = {
    groups: $("#fridgeGroups"), other: $("#fridgeOther"), allergy: $("#fridgeAllergy"), preview: $("#fridgePreview"),
    time: $("#fridgeTime"), tools: $("#fridgeTools"), diet: $("#fridgeDiet"),
    peopleOut: $("#peopleOut"), minus: $("#peopleMinus"), plus: $("#peoplePlus"),
    send: $("#fridgeSend"), fill: $("#fridgeFill"), clear: $("#fridgeClear")
  };
  const esc = window.Chef.esc;

  const DEFAULTS = { items: [], other: "", people: 1, time: 30, tools: ["fogão"], diets: [], allergy: "" };
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.items) && Array.isArray(d.tools) && Array.isArray(d.diets)) return { ...DEFAULTS, ...d };
    } catch (e) { /* começa do padrão */ }
    return JSON.parse(JSON.stringify(DEFAULTS)); // cópia, para não alterar o padrão
  }
  let state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignora */ } }

  /** Junta uma lista em português: "a, b e c". */
  const join = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`);

  /** Lista final de ingredientes: os marcados mais os digitados. */
  function ingredients() {
    const typed = state.other.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    return [...state.items, ...typed];
  }

  /** Monta a mensagem que vai para o Chef. */
  function buildMessage() {
    const list = ingredients();
    if (!list.length) return "";
    const parts = [`Tenho: ${join(list)}.`];
    parts.push(`Para ${state.people} ${state.people === 1 ? "pessoa" : "pessoas"}, até ${state.time} minutos.`);
    if (state.tools.length) parts.push(`Utensílios: ${join(state.tools)}.`);
    const allergy = state.allergy.trim();
    if (state.diets.length) parts.push(`Restrições: ${join(state.diets)}.`);
    parts.push(allergy ? `Alergia a: ${allergy}.` : "Sem alergias.");
    return parts.join(" ");
  }

  const chip = (group, value, pressed, label) =>
    `<button type="button" class="chip" data-group="${group}" data-value="${esc(value)}" aria-pressed="${pressed}">${esc(label || value)}</button>`;

  function render() {
    el.groups.innerHTML = GROUPS.map((g) => `<fieldset><legend>${esc(g.name)}</legend><div class="chips">${
      g.items.map((it) => chip("items", it, state.items.includes(it))).join("")}</div></fieldset>`).join("");
    el.time.innerHTML = TIMES.map((t) => chip("time", String(t), state.time === t, t === 60 ? "1 hora" : `${t} min`)).join("");
    el.tools.innerHTML = TOOLS.map((t) => chip("tools", t, state.tools.includes(t))).join("");
    el.diet.innerHTML = DIETS.map((d) => chip("diets", d, state.diets.includes(d))).join("");
    el.other.value = state.other;
    el.allergy.value = state.allergy;
    update();
  }

  /** Atualiza a prévia e os botões sem redesenhar as listas. */
  function update() {
    el.peopleOut.textContent = String(state.people);
    const msg = buildMessage();
    const tooLong = msg.length > MAX_LEN;
    el.preview.textContent = !msg ? "Marque pelo menos um ingrediente." : tooLong ? `A mensagem passou de ${MAX_LEN} caracteres. Tire alguns ingredientes.` : msg;
    el.preview.classList.toggle("empty", !msg || tooLong);
    el.send.disabled = el.fill.disabled = !msg || tooLong;
    save();
  }

  /** Liga e desliga um valor numa lista. */
  function toggle(list, value) {
    const i = list.indexOf(value);
    if (i === -1) list.push(value); else list.splice(i, 1);
  }

  dialog.addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const { group, value } = c.dataset;
    if (group === "time") {
      state.time = Number(value);
      el.time.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", b === c));
    } else {
      toggle(state[group], value);
      c.setAttribute("aria-pressed", state[group].includes(value));
    }
    update();
  });
  el.other.addEventListener("input", () => { state.other = el.other.value; update(); });
  el.allergy.addEventListener("input", () => { state.allergy = el.allergy.value; update(); });
  el.minus.addEventListener("click", () => { state.people = Math.max(1, state.people - 1); update(); });
  el.plus.addEventListener("click", () => { state.people = Math.min(12, state.people + 1); update(); });
  el.clear.addEventListener("click", () => {
    // Limpa os ingredientes; as preferências (pessoas, tempo, utensílios, restrições) continuam.
    state.items = [];
    state.other = "";
    render();
  });
  el.fill.addEventListener("click", () => { const msg = buildMessage(); dialog.close(); window.Chef.setInput(msg); });
  el.send.addEventListener("click", () => {
    if (window.Chef.isBusy()) { window.Chef.toast("Espere o Chef terminar de responder."); return; }
    const msg = buildMessage();
    dialog.close();
    window.Chef.send(msg);
  });

  function open() { render(); dialog.showModal(); }
  $("#fridgeBtn").addEventListener("click", open);
  $("#fridgeCta").addEventListener("click", open);
})();
