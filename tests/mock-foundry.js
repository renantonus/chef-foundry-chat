/**
 * Foundry FALSO, só para os testes automáticos.
 * Imita as rotas /openai/v1/conversations e /openai/v1/responses e confere
 * se o nosso back end manda o token e a referência do agente do jeito certo.
 * Não é usado pela aplicação: ela sempre fala com o Foundry de verdade.
 */
"use strict";
const http = require("http");

// agentField: nome do campo que este Foundry falso aceita ("agent_reference" é o formato atual; "agent" imita versões antigas).
function startMockFoundry({ agentName = "automatenan", token = "token-de-teste", agentField = "agent_reference" } = {}) {
  const conversations = new Map(); // id -> quantas mensagens já recebeu
  const requests = [];
  let next = 1;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url, auth: req.headers.authorization, body });
      const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };

      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: { code: "unauthorized" } });

      if (req.method === "POST" && req.url === "/api/projects/teste/openai/v1/conversations") {
        const id = `conv_${next++}`;
        conversations.set(id, 0);
        return send(200, { id, object: "conversation" });
      }

      if (req.method === "POST" && req.url === "/api/projects/teste/openai/v1/responses") {
        const otherField = agentField === "agent" ? "agent_reference" : "agent";
        if (body[otherField] !== undefined) {
          return send(400, { error: { code: "invalid_request", message: `Unknown parameter: '${otherField}'.` } });
        }
        const ref = body[agentField];
        if (!ref || ref.type !== "agent_reference" || ref.name !== agentName) {
          return send(404, { error: { code: "agent_not_found", message: "Agent not found" } });
        }
        if (!conversations.has(body.conversation)) {
          return send(404, { error: { code: "not_found", message: "Conversation not found" } });
        }
        if (body.input === "LENTO") return setTimeout(() => send(200, {}), 2000);
        if (body.input === "ERRO500") return send(500, { error: { code: "server_error", message: "detalhe técnico interno" } });
        if (body.input === "LIMITE") return send(429, { error: { code: "rate_limit" } });
        const turn = conversations.get(body.conversation) + 1;
        conversations.set(body.conversation, turn);
        return send(200, {
          id: `resp_${turn}`,
          status: "completed",
          output: [
            { type: "reasoning", summary: [] },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: `Mensagem ${turn} da conversa ${body.conversation}: ${body.input}` }] }
          ]
        });
      }
      send(404, { error: { code: "not_found" } });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, requests, conversations, endpoint: `http://127.0.0.1:${port}/api/projects/teste`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startMockFoundry };
