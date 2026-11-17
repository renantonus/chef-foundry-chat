/**
 * Servidor HTTP (back end / proxy).
 * - Serve os arquivos do front end (pasta public).
 * - POST /api/chat: valida a mensagem, chama o agente no Foundry e devolve a resposta.
 * - POST /api/chat/stream: igual, mas devolve a resposta aos poucos (streaming).
 * - GET  /api/health: diz se o servidor está configurado (sem expor nenhum valor).
 * - POST /api/feedback: registra 👍/👎 (só a contagem, sem o conteúdo da conversa).
 *
 * Privacidade: os logs registram só método, rota, status e tempo. Nunca o texto das mensagens.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { validateChatBody } = require("./validate");
const { missingConfig } = require("./config");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MAX_BODY_BYTES = 16 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json"
};

// Mensagens amigáveis para cada tipo de falha (o usuário nunca vê detalhes técnicos).
const FRIENDLY = {
  timeout: { status: 504, message: "O Chef demorou demais para responder. Tente de novo em instantes." },
  rate_limit: { status: 429, message: "Muitas mensagens em pouco tempo. Espere um minutinho e tente de novo." },
  network: { status: 502, message: "Não consegui falar com o Chef agora (falha de conexão). Tente de novo em instantes." },
  default: { status: 503, message: "O Chef está indisponível no momento. Tente de novo em alguns instantes." }
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

/** Limite simples de mensagens por minuto por IP (ajuda a controlar custos). */
function createRateLimiter(limitPerMinute) {
  const hits = new Map();
  return function allow(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= limitPerMinute) { hits.set(ip, recent); return false; }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}
const sendError = (res, status, code, message) => sendJson(res, status, { error: { code, message } });

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("too_large"), { code: "too_large" })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("bad_json"), { code: "bad_json" })); }
    });
    req.on("error", reject);
  });
}

/**
 * Cria o "app" (a função que trata cada requisição).
 * @param {object} deps
 * @param {object} deps.config  Configuração (server/config.js)
 * @param {object} deps.client  Cliente do agente (server/foundry.js)
 * @param {object} [deps.logger] Onde escrever os logs (console por padrão)
 */
function createApp({ config, client, logger = console }) {
  const allow = createRateLimiter(config.rateLimitPerMinute);
  const missing = missingConfig(config);
  const feedback = { up: 0, down: 0 };

  /** Lê e valida o pedido do chat. Se algo estiver errado, já responde o erro e devolve null. */
  async function readChatRequest(req, res) {
    if (!(req.headers["content-type"] || "").includes("application/json")) {
      sendError(res, 415, "unsupported_media_type", "Envie a mensagem como JSON.");
      return null;
    }
    if (!allow(req.socket.remoteAddress || "local")) {
      sendError(res, 429, "rate_limit", FRIENDLY.rate_limit.message);
      return null;
    }
    let body;
    try { body = await readJsonBody(req); } catch (err) {
      if (err.code === "too_large") sendError(res, 413, "too_large", "A mensagem é grande demais.");
      else sendError(res, 400, "bad_json", "Formato inválido. Envie um JSON com o campo \"message\".");
      return null;
    }
    const v = validateChatBody(body, config.maxMessageLength);
    if (!v.ok) { sendError(res, v.status, "invalid_message", v.error); return null; }
    if (missing.length) { sendError(res, 503, "not_configured", "O Chef ainda não foi configurado no servidor."); return null; }
    return v;
  }

  /**
   * Conversa com o agente: cria a conversa no Foundry se ainda não existir e envia a mensagem.
   * `ask(conversationId)` faz o envio (de uma vez ou em streaming) e devolve o texto da resposta.
   */
  async function converse(v, ask) {
    let conversationId = v.conversationId;
    let notice = null;
    if (!conversationId) conversationId = await client.createConversation();
    let reply;
    try {
      reply = await ask(conversationId);
    } catch (err) {
      // A conversa salva no navegador pode ter expirado no Foundry: começa outra e tenta uma vez.
      if (err.code !== "conversation_not_found" || !v.conversationId) throw err;
      conversationId = await client.createConversation();
      reply = await ask(conversationId);
      notice = "A conversa anterior não estava mais disponível, então comecei uma nova.";
    }
    return { reply, conversationId, notice };
  }

  function logAgentError(err) {
    logger.error(`[agente] falha: ${err.code || "erro"}${err.httpStatus ? " (HTTP " + err.httpStatus + ")" : ""} - ${err.message}`);
  }

  /** POST /api/chat: devolve a resposta inteira, de uma vez. */
  async function handleChat(req, res) {
    const v = await readChatRequest(req, res);
    if (!v) return;
    try {
      return sendJson(res, 200, await converse(v, (id) => client.sendMessage(id, v.message)));
    } catch (err) {
      const f = FRIENDLY[err.code] || FRIENDLY.default;
      logAgentError(err);
      return sendError(res, f.status, err.code || "agent_error", f.message);
    }
  }

  /**
   * POST /api/chat/stream: devolve a resposta aos poucos, uma linha de JSON por evento (NDJSON):
   *   {"type":"meta","conversationId":"..."}   id da conversa (antes do primeiro pedaço)
   *   {"type":"delta","text":"..."}            pedaço do texto
   *   {"type":"done","reply":"...","conversationId":"...","notice":null}
   *   {"type":"error","message":"..."}         falha no meio da resposta (mensagem amigável)
   * Se a falha acontecer antes do primeiro pedaço, a resposta é um erro JSON comum, igual ao /api/chat.
   */
  async function handleChatStream(req, res) {
    const v = await readChatRequest(req, res);
    if (!v) return;
    // Se o navegador fechar a conexão (botão "Parar"), cancela a chamada ao Foundry.
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });

    let started = false;
    const write = (event) => {
      if (!started) {
        started = true;
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", ...SECURITY_HEADERS });
      }
      res.write(JSON.stringify(event) + "\n");
    };
    try {
      const result = await converse(v, (id) => {
        if (!config.streaming) return client.sendMessage(id, v.message, abort.signal);
        return client.streamMessage(id, v.message, (text) => {
          if (!started) write({ type: "meta", conversationId: id });
          write({ type: "delta", text });
        }, abort.signal);
      });
      if (!started) {
        // Sem streaming: manda a resposta inteira como um pedaço só.
        write({ type: "meta", conversationId: result.conversationId });
        write({ type: "delta", text: result.reply });
      }
      write({ type: "done", ...result });
      res.end();
    } catch (err) {
      if (abort.signal.aborted) return res.end(); // o usuário parou: não é erro
      const f = FRIENDLY[err.code] || FRIENDLY.default;
      logAgentError(err);
      if (!started) return sendError(res, f.status, err.code || "agent_error", f.message);
      write({ type: "error", code: err.code || "agent_error", message: f.message });
      res.end();
    }
  }

  async function handleFeedback(req, res) {
    let body;
    try { body = await readJsonBody(req); } catch { return sendError(res, 400, "bad_json", "Formato inválido."); }
    if (!body || !["up", "down"].includes(body.value)) return sendError(res, 400, "invalid_feedback", "Use \"up\" ou \"down\".");
    feedback[body.value]++;
    logger.log(`[feedback] 👍 ${feedback.up} · 👎 ${feedback.down}`);
    return sendJson(res, 200, { ok: true });
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendError(res, 403, "forbidden", "Acesso negado.");
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return sendError(res, 404, "not_found", "Não encontrado.");
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      fs.createReadStream(file).pipe(res);
    });
  }

  return async function app(req, res) {
    const started = Date.now();
    res.on("finish", () => logger.log(`${req.method} ${req.url.split("?")[0]} ${res.statusCode} ${Date.now() - started}ms`));
    const { pathname } = new URL(req.url, "http://localhost");
    try {
      if (pathname === "/api/health" && req.method === "GET") {
        return sendJson(res, 200, { ok: true, configured: missing.length === 0, agent: config.agentName || null, streaming: !!config.streaming });
      }
      if (pathname === "/api/chat") {
        if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use POST.");
        return await handleChat(req, res);
      }
      if (pathname === "/api/chat/stream") {
        if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Use POST.");
        return await handleChatStream(req, res);
      }
      if (pathname === "/api/feedback" && req.method === "POST") return await handleFeedback(req, res);
      if (pathname.startsWith("/api/")) return sendError(res, 404, "not_found", "Rota não encontrada.");
      if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, 405, "method_not_allowed", "Método não permitido.");
      return serveStatic(req, res, pathname);
    } catch (err) {
      logger.error(`[servidor] erro inesperado: ${err.message}`);
      if (!res.headersSent) sendError(res, 500, "internal", "Erro interno. Tente de novo.");
    }
  };
}

module.exports = { createApp, createRateLimiter };
