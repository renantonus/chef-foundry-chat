/**
 * Diagnóstico da conexão com o agente no Foundry.
 * Rode na pasta do projeto:  node diagnostico.js
 * Testa as variações da chamada e mostra o status e a resposta completa de cada uma.
 * Não mostra o token. Pode mandar o print do resultado.
 */
"use strict";
const { loadEnvFile, getConfig } = require("./server/config");

loadEnvFile();
const cfg = getConfig();
const PREVIEW = "api-version=2025-11-15-preview";

function show(label, status, text) {
  console.log(`\n--- ${label}`);
  console.log(`status: ${status}`);
  console.log((text || "(corpo vazio)").slice(0, 600));
}

async function main() {
  console.log("Endpoint:", cfg.endpoint || "(vazio)");
  console.log("Agente:", cfg.agentName || "(vazio)", cfg.agentVersion ? `versão ${cfg.agentVersion}` : "(versão mais recente)");
  if (!cfg.endpoint || !cfg.agentName) return console.log("\nFalta preencher o .env.");
  if (!/^https:\/\/[^/]+\.services\.ai\.azure\.com\/api\/projects\/[^/]+$/.test(cfg.endpoint)) {
    console.log("AVISO: o endpoint não está no formato https://<recurso>.services.ai.azure.com/api/projects/<projeto>");
  }

  let token;
  try {
    const { DefaultAzureCredential } = require("@azure/identity");
    token = (await new DefaultAzureCredential().getToken("https://ai.azure.com/.default")).token;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    console.log("Token OK. Conta:", claims.upn || claims.unique_name || claims.appid, "| tenant:", claims.tid);
  } catch (err) {
    return console.log("\nFalha ao pegar o token:", err.message);
  }

  const call = async (label, path, body) => {
    try {
      const res = await fetch(cfg.endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      show(label, res.status, text);
      try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status }; }
    } catch (err) {
      show(label, "erro de rede", err.message);
      return { status: 0 };
    }
  };

  const ref = { type: "agent_reference", name: cfg.agentName };
  if (cfg.agentVersion) ref.version = cfg.agentVersion;

  const c1 = await call("1. criar conversa (v1)", "/openai/v1/conversations", {});
  const c2 = await call("2. criar conversa (preview)", `/openai/conversations?${PREVIEW}`, {});
  const conv = (c1.data && c1.data.id) || (c2.data && c2.data.id);
  console.log("\nConversa criada:", conv || "(nenhuma)");

  const input = "Tenho 2 ovos e 1 tomate. O que dá pra fazer?";
  const variants = [
    ["3. resposta v1 + agent_reference", "/openai/v1/responses", { agent_reference: ref, conversation: conv, input }],
    ["4. resposta v1 + agent", "/openai/v1/responses", { agent: ref, conversation: conv, input }],
    ["5. resposta v1 + agent_reference, sem conversa", "/openai/v1/responses", { agent_reference: ref, input }],
    ["6. resposta preview + agent", `/openai/responses?${PREVIEW}`, { agent: ref, conversation: conv, input }]
  ];
  let working = null;
  for (const [label, path, body] of variants) {
    if (!conv) delete body.conversation;
    const r = await call(label, path, body);
    if (r.status === 200) {
      console.log(`\n>>> A variação "${label}" FUNCIONOU.`);
      working = { path, body };
      break;
    }
  }

  // Teste do streaming (resposta aos poucos), usando a variação que funcionou.
  if (working) {
    console.log("\n--- 7. streaming (stream: true)");
    try {
      const res = await fetch(cfg.endpoint + working.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...working.body, input: "Responda só: ok", stream: true })
      });
      const type = res.headers.get("content-type") || "";
      console.log(`status: ${res.status} | content-type: ${type}`);
      const text = await res.text();
      if (res.ok && type.includes("text/event-stream")) {
        const pieces = (text.match(/"type":\s*"response\.output_text\.delta"/g) || []).length;
        console.log(`>>> STREAMING FUNCIONA: a resposta veio em ${pieces} pedaço(s).`);
      } else if (res.ok) {
        console.log(">>> O Foundry respondeu de uma vez (sem streaming). O chat funciona do mesmo jeito.");
      } else {
        console.log(text.slice(0, 400));
        console.log(">>> O Foundry recusou o streaming. O chat volta sozinho para a resposta inteira.");
      }
    } catch (err) {
      console.log("erro de rede:", err.message);
    }
  }
}

main();
