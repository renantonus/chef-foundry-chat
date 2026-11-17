/**
 * Testes do back end (node --test). Usam o Foundry falso de tests/mock-foundry.js.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { startMockFoundry } = require("./mock-foundry");
const { createFoundryClient } = require("../server/foundry");
const { createApp } = require("../server/app");
const { getConfig } = require("../server/config");

const quietLogger = { log() {}, error() {} };

async function startApp(overrides = {}, clientOverrides = {}, mockOptions = {}) {
  const mock = await startMockFoundry(mockOptions);
  const config = { ...getConfig({}), endpoint: mock.endpoint, agentName: "automatenan", timeoutMs: 500, rateLimitPerMinute: 100, ...overrides };
  const client = createFoundryClient({
    endpoint: config.endpoint, agentName: config.agentName, timeoutMs: config.timeoutMs,
    getToken: async () => "token-de-teste", ...clientOverrides
  });
  const logs = [];
  const logger = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  const server = http.createServer(createApp({ config, client, logger }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, mock, logs, close: async () => { await new Promise((r) => server.close(r)); await mock.close(); } };
}

const chat = (base, body, headers = { "Content-Type": "application/json" }) =>
  fetch(base + "/api/chat", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("health não expõe o endpoint nem segredos", async () => {
  const app = await startApp();
  const res = await fetch(app.base + "/api/health");
  const json = await res.json();
  assert.deepStrictEqual(json, { ok: true, configured: true, agent: "automatenan", streaming: true });
  assert.ok(!JSON.stringify(json).includes("127.0.0.1"));
  await app.close();
});

test("rejeita mensagem vazia com 400", async () => {
  const app = await startApp();
  const res = await chat(app.base, { message: "   " });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error.message, /vazia/);
  assert.strictEqual(app.mock.requests.length, 0, "não chamou o agente");
  await app.close();
});

test("rejeita mensagem longa demais com 400", async () => {
  const app = await startApp({ maxMessageLength: 20 });
  const res = await chat(app.base, { message: "a".repeat(21) });
  assert.strictEqual(res.status, 400);
  await app.close();
});

test("rejeita formato errado: sem JSON, JSON inválido e campo errado", async () => {
  const app = await startApp();
  assert.strictEqual((await chat(app.base, "oi", { "Content-Type": "text/plain" })).status, 415);
  assert.strictEqual((await chat(app.base, "{quebrado")).status, 400);
  assert.strictEqual((await chat(app.base, { message: 123 })).status, 400);
  assert.strictEqual((await chat(app.base, { message: "oi", conversationId: "../../hack" })).status, 400);
  await app.close();
});

test("primeira mensagem cria a conversa e devolve a resposta do agente", async () => {
  const app = await startApp();
  const res = await chat(app.base, { message: "Tenho ovo e queijo" });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.conversationId, "conv_1");
  assert.match(json.reply, /Mensagem 1 da conversa conv_1: Tenho ovo e queijo/);
  const call = app.mock.requests.find((r) => r.path.endsWith("/responses"));
  assert.strictEqual(call.auth, "Bearer token-de-teste");
  assert.deepStrictEqual(call.body.agent_reference, { type: "agent_reference", name: "automatenan" });
  await app.close();
});

test("multi-turno: a segunda mensagem reutiliza a mesma conversa", async () => {
  const app = await startApp();
  const first = await (await chat(app.base, { message: "Tenho arroz" })).json();
  const second = await (await chat(app.base, { message: "Somos 2 pessoas", conversationId: first.conversationId })).json();
  assert.strictEqual(second.conversationId, first.conversationId);
  assert.match(second.reply, /Mensagem 2 da conversa conv_1/);
  assert.strictEqual(app.mock.requests.filter((r) => r.path.endsWith("/conversations")).length, 1);
  await app.close();
});

test("conversa expirada: começa outra e avisa", async () => {
  const app = await startApp();
  const json = await (await chat(app.base, { message: "Oi", conversationId: "conv_999" })).json();
  assert.strictEqual(json.conversationId, "conv_1");
  assert.match(json.notice, /comecei uma nova/);
  await app.close();
});

test("demora excessiva vira 504 com mensagem amigável", async () => {
  const app = await startApp();
  const res = await chat(app.base, { message: "LENTO" });
  assert.strictEqual(res.status, 504);
  assert.match((await res.json()).error.message, /demorou demais/);
  await app.close();
});

test("erro do agente vira 503 sem detalhe técnico", async () => {
  const app = await startApp();
  const res = await chat(app.base, { message: "ERRO500" });
  const json = await res.json();
  assert.strictEqual(res.status, 503);
  assert.match(json.error.message, /indisponível/);
  assert.ok(!JSON.stringify(json).includes("detalhe técnico"));
  await app.close();
});

test("limite do Foundry vira 429", async () => {
  const app = await startApp();
  assert.strictEqual((await chat(app.base, { message: "LIMITE" })).status, 429);
  await app.close();
});

test("falha de autenticação vira 503 amigável", async () => {
  const app = await startApp({}, { getToken: async () => { const e = new Error("sem login"); e.code = "auth"; throw e; } });
  const res = await chat(app.base, { message: "Oi" });
  assert.strictEqual(res.status, 503);
  await app.close();
});

test("falha de rede vira 502 amigável", async () => {
  const app = await startApp({ endpoint: "http://127.0.0.1:1/api/projects/teste" }, { endpoint: "http://127.0.0.1:1/api/projects/teste" });
  const res = await chat(app.base, { message: "Oi" });
  assert.strictEqual(res.status, 502);
  assert.match((await res.json()).error.message, /conexão/);
  await app.close();
});

test("sem configuração responde 503 e não chama o Foundry", async () => {
  const app = await startApp({ endpoint: "", agentName: "" });
  const res = await chat(app.base, { message: "Oi" });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(app.mock.requests.length, 0);
  await app.close();
});

test("limite de mensagens por minuto (custos)", async () => {
  const app = await startApp({ rateLimitPerMinute: 2 });
  await chat(app.base, { message: "um" });
  await chat(app.base, { message: "dois" });
  assert.strictEqual((await chat(app.base, { message: "três" })).status, 429);
  await app.close();
});

test("logs não registram o texto das mensagens (privacidade)", async () => {
  const app = await startApp();
  await chat(app.base, { message: "meu endereço é Rua Secreta 123" });
  await chat(app.base, { message: "ERRO500" });
  assert.ok(app.logs.length > 0);
  assert.ok(app.logs.every((l) => !l.includes("Rua Secreta")));
  await app.close();
});

test("serve o front end com cabeçalhos de segurança e bloqueia path traversal", async () => {
  const app = await startApp();
  const res = await fetch(app.base + "/");
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  const bad = await fetch(app.base + "/..%2f.env");
  assert.ok([403, 404].includes(bad.status));
  await app.close();
});

test("nenhum arquivo do front end contém endpoint ou token", async () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "public");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir)) {
    const txt = fs.readFileSync(f, "utf8");
    assert.ok(!/services\.ai\.azure\.com|Bearer |AZURE_CLIENT_SECRET|ai\.azure\.com\/\.default/.test(txt), f);
  }
});

test("Foundry com formato antigo: tenta o campo \"agent\" e depois lembra dele", async () => {
  const app = await startApp({}, {}, { agentField: "agent" });
  const res1 = await chat(app.base, { message: "oi" });
  assert.strictEqual(res1.status, 200);
  const { conversationId } = await res1.json();
  const res2 = await chat(app.base, { message: "de novo", conversationId });
  assert.strictEqual(res2.status, 200);
  const calls = app.mock.requests.filter((r) => r.path.endsWith("/responses"));
  assert.deepStrictEqual(calls.map((c) => Object.keys(c.body).find((k) => k.startsWith("agent"))), ["agent_reference", "agent", "agent"]);
  await app.close();
});

test("log mostra a mensagem de erro do Foundry para diagnóstico", async () => {
  const app = await startApp();
  await chat(app.base, { message: "ERRO500" });
  assert.ok(app.logs.some((l) => l.includes("detalhe técnico interno")));
  await app.close();
});

/* ---------- streaming ---------- */
const chatStream = (base, body) =>
  fetch(base + "/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const readEvents = async (res) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

test("streaming: a resposta chega em pedaços e termina com o texto completo", async () => {
  const app = await startApp();
  const res = await chatStream(app.base, { message: "tenho ovo e tomate" });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-type"), /ndjson/);
  const events = await readEvents(res);
  assert.strictEqual(events[0].type, "meta");
  const deltas = events.filter((e) => e.type === "delta");
  assert.ok(deltas.length > 3, "deveria vir em vários pedaços");
  const done = events[events.length - 1];
  assert.strictEqual(done.type, "done");
  assert.strictEqual(deltas.map((d) => d.text).join("").trim(), done.reply);
  assert.strictEqual(done.conversationId, events[0].conversationId);
  assert.strictEqual(app.mock.requests.find((r) => r.path.endsWith("/responses")).body.stream, true);
  await app.close();
});

test("streaming: multi-turno reutiliza a conversa", async () => {
  const app = await startApp();
  const first = (await readEvents(await chatStream(app.base, { message: "oi" }))).pop();
  const second = (await readEvents(await chatStream(app.base, { message: "de novo", conversationId: first.conversationId }))).pop();
  assert.strictEqual(second.conversationId, first.conversationId);
  assert.match(second.reply, /^Mensagem 2 /);
  await app.close();
});

test("streaming: se o Foundry recusar o stream, usa a resposta inteira e não pede stream de novo", async () => {
  const app = await startApp({}, {}, { streaming: "reject" });
  const events = await readEvents(await chatStream(app.base, { message: "oi" }));
  assert.strictEqual(events.pop().type, "done");
  assert.strictEqual(events.filter((e) => e.type === "delta").length, 1);
  await readEvents(await chatStream(app.base, { message: "oi de novo" }));
  const calls = app.mock.requests.filter((r) => r.path.endsWith("/responses"));
  assert.strictEqual(calls[calls.length - 1].body.stream, undefined);
  await app.close();
});

test("streaming: Foundry que ignora o stream e responde JSON também funciona", async () => {
  const app = await startApp({}, {}, { streaming: "ignore" });
  const events = await readEvents(await chatStream(app.base, { message: "oi" }));
  assert.match(events.pop().reply, /^Mensagem 1 /);
  await app.close();
});

test("streaming desligado (STREAMING=off) devolve a resposta em um pedaço só", async () => {
  const app = await startApp({ streaming: false });
  const events = await readEvents(await chatStream(app.base, { message: "oi" }));
  assert.deepStrictEqual(events.map((e) => e.type), ["meta", "delta", "done"]);
  assert.strictEqual(app.mock.requests.find((r) => r.path.endsWith("/responses")).body.stream, undefined);
  await app.close();
});

test("streaming: erro antes do primeiro pedaço vira erro JSON amigável", async () => {
  const app = await startApp();
  const res = await chatStream(app.base, { message: "ERRO500" });
  const json = await res.json();
  assert.strictEqual(res.status, 503);
  assert.match(json.error.message, /indisponível/);
  assert.ok(!JSON.stringify(json).includes("detalhe técnico"));
  await app.close();
});

test("streaming: falha no meio da resposta vira evento de erro sem detalhe técnico", async () => {
  const app = await startApp();
  const res = await chatStream(app.base, { message: "QUEBRA" });
  const raw = await res.text();
  const events = raw.trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(events.pop().type, "error");
  assert.ok(!raw.includes("detalhe técnico"));
  assert.ok(app.logs.some((l) => l.includes("detalhe técnico interno")));
  await app.close();
});

test("streaming: valida a mensagem do mesmo jeito (400)", async () => {
  const app = await startApp();
  assert.strictEqual((await chatStream(app.base, { message: "   " })).status, 400);
  assert.strictEqual((await chatStream(app.base, { message: "x".repeat(1001) })).status, 400);
  await app.close();
});

test("streaming: demora excessiva vira 504", async () => {
  const app = await startApp();
  const res = await chatStream(app.base, { message: "LENTO" });
  assert.strictEqual(res.status, 504);
  await app.close();
});
