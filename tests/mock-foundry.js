/**
 * Foundry FALSO, só para os testes automáticos.
 * Imita as rotas /openai/v1/conversations e /openai/v1/responses e confere
 * se o nosso back end manda o token e a referência do agente do jeito certo.
 * Não é usado pela aplicação: ela sempre fala com o Foundry de verdade.
 */
"use strict";
const http = require("http");

// streaming: "sse" (aceita stream:true e responde aos poucos), "reject" (recusa com 400) ou "ignore" (responde JSON inteiro).
// agentField: nome do campo que este Foundry falso aceita ("agent_reference" é o formato atual; "agent" imita versões antigas).
function startMockFoundry({ agentName = "automatenan", token = "token-de-teste", agentField = "agent_reference", streaming = "sse" } = {}) {
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
        if (body.stream && streaming === "reject") {
          return send(400, { error: { code: "invalid_request", message: "Streaming is not supported." } });
        }
        if (body.input === "LENTO") return setTimeout(() => send(200, {}), 2000);
        if (body.input === "ERRO500") return send(500, { error: { code: "server_error", message: "detalhe técnico interno" } });
        if (body.input === "LIMITE") return send(429, { error: { code: "rate_limit" } });
        const turn = conversations.get(body.conversation) + 1;
        conversations.set(body.conversation, turn);
        const replyText = `Mensagem ${turn} da conversa ${body.conversation}: ${body.input}`;
        if (body.stream && streaming === "sse") {
          // Responde em Server-Sent Events, um pedaço por palavra, como o Foundry de verdade.
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          const sse = (ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          sse({ type: "response.created", response: { id: `resp_${turn}` } });
          const pieces = replyText.split(/(?<= )/);
          if (body.input === "QUEBRA") {
            sse({ type: "response.output_text.delta", delta: pieces[0] });
            sse({ type: "response.failed", response: { error: { code: "server_error", message: "detalhe técnico interno" } } });
            return res.end();
          }
          for (const piece of pieces) sse({ type: "response.output_text.delta", delta: piece });
          sse({ type: "response.completed", response: { id: `resp_${turn}`, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: replyText }] }] } });
          return res.end();
        }
        return send(200, {
          id: `resp_${turn}`,
          status: "completed",
          output: [
            { type: "reasoning", summary: [] },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: replyText }] }
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
