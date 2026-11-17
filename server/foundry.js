/**
 * Integração com o agente no Microsoft Foundry.
 *
 * Fluxo:
 * 1. Pega um token do Microsoft Entra ID (escopo https://ai.azure.com/.default).
 * 2. Cria uma conversa (POST {endpoint}/openai/v1/conversations) só na primeira mensagem.
 * 3. Envia cada mensagem para o agente (POST {endpoint}/openai/v1/responses),
 *    referenciando o agente pelo nome e reutilizando o id da conversa (multi-turno).
 * 4. Com "stream": true, o Foundry devolve o texto aos poucos (streaming); se ele recusar,
 *    o cliente volta sozinho para a resposta inteira.
 *
 * O token NUNCA vai para o navegador: este arquivo só roda no servidor.
 */
"use strict";

const TOKEN_SCOPE = "https://ai.azure.com/.default";

/** Erro "conhecido" da integração, com um código para o servidor decidir a mensagem ao usuário. */
class AgentError extends Error {
  constructor(code, detail, httpStatus) {
    super(detail || code);
    this.name = "AgentError";
    this.code = code; // auth | not_found | conversation_not_found | rate_limit | timeout | network | unavailable | bad_response | aborted
    this.httpStatus = httpStatus || null;
  }
}

/**
 * Cria a função que obtém o token do Entra ID.
 * Usa o DefaultAzureCredential: no seu PC ele usa o login do Azure CLI (`az login`);
 * publicado, ele usa as variáveis AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET.
 * O token fica em cache até 5 minutos antes de expirar, para não pedir um novo a cada mensagem.
 */
function createTokenProvider() {
  let credential = null;
  let cached = null;
  return async function getToken() {
    if (cached && cached.expiresOnTimestamp - Date.now() > 5 * 60 * 1000) return cached.token;
    try {
      if (!credential) {
        // Carregado só aqui para os testes poderem rodar sem o pacote instalado.
        const { DefaultAzureCredential } = require("@azure/identity");
        credential = new DefaultAzureCredential();
      }
      const token = await credential.getToken(TOKEN_SCOPE);
      if (!token || !token.token) throw new Error("token vazio");
      cached = token;
      return token.token;
    } catch (err) {
      if (err.code === "MODULE_NOT_FOUND") {
        throw new AgentError("auth", "Pacote @azure/identity não instalado. Rode: npm install");
      }
      throw new AgentError("auth", `Falha ao obter token do Entra ID (você fez "az login"?): ${err.message}`);
    }
  };
}

/** Junta o texto da resposta do agente (formato da Responses API). */
function extractReplyText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n\n").trim();
}

/** Pega a mensagem de erro que o Foundry devolveu (para o log do servidor, nunca para o usuário). */
function foundryErrorMessage(bodyText) {
  try {
    const data = JSON.parse(bodyText);
    const msg = (data.error && (data.error.message || data.error.code)) || data.message;
    if (msg) return String(msg).slice(0, 300);
  } catch {
    /* corpo não é JSON */
  }
  return String(bodyText || "").slice(0, 300);
}

/** Converte o status HTTP do Foundry em um código de erro nosso. */
function errorFromStatus(status, bodyText, path) {
  const lower = (bodyText || "").toLowerCase();
  const detail = foundryErrorMessage(bodyText);
  if (status === 401 || status === 403) return new AgentError("auth", `Foundry recusou o acesso (${status})`, status);
  if (status === 404 && path.includes("/responses") && lower.includes("conversation")) {
    return new AgentError("conversation_not_found", "Conversa não encontrada no Foundry", status);
  }
  if (status === 404) return new AgentError("not_found", "Agente ou endpoint não encontrado (404)", status);
  if (status === 408 || status === 504) return new AgentError("timeout", `Foundry demorou demais (${status})`, status);
  if (status === 429) return new AgentError("rate_limit", "Limite de uso do Foundry atingido (429)", status);
  if (status === 400 && lower.includes("conversation") && /not.?found|does not exist|invalid conversation/.test(lower)) {
    return new AgentError("conversation_not_found", "Conversa inválida no Foundry (400)", status);
  }
  const err = new AgentError("unavailable", `Foundry respondeu ${status}${detail ? `: ${detail}` : ""}`, status);
  err.body = lower;
  return err;
}

/**
 * Cria o cliente do agente.
 * @param {object} opts
 * @param {string} opts.endpoint   Endpoint do projeto no Foundry
 * @param {string} opts.agentName  Nome do agente (ex.: automatenan)
 * @param {string} [opts.agentVersion] Versão fixa do agente (opcional)
 * @param {Function} opts.getToken Função que devolve o token do Entra ID
 * @param {Function} [opts.fetchImpl] fetch a usar (os testes trocam por um falso)
 * @param {number} [opts.timeoutMs] Tempo máximo de espera por chamada
 */
function createFoundryClient({ endpoint, agentName, agentVersion, getToken, fetchImpl = fetch, timeoutMs = 60000 }) {
  /**
   * Faz um POST ao Foundry e devolve a resposta ainda "aberta" (o corpo é lido depois).
   * O relógio de espera (timeout) pode ser reiniciado com touch(): no streaming, cada pedaço
   * que chega reinicia a contagem. `signal` permite cancelar (o usuário clicou em "Parar").
   */
  async function request(path, body, signal) {
    const token = await getToken();
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    };
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const done = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    /** Traduz uma falha do fetch (ou da leitura do corpo) para um erro nosso. */
    const fail = (err) => {
      if (err instanceof AgentError) return err;
      if (err.name === "AbortError" || controller.signal.aborted) {
        return timedOut ? new AgentError("timeout", `Sem resposta em ${timeoutMs} ms`) : new AgentError("aborted", "Chamada cancelada");
      }
      return new AgentError("network", `Falha de rede ao chamar o Foundry: ${err.message}`);
    };
    touch();
    let res;
    try {
      res = await fetchImpl(endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      done();
      throw fail(err);
    }
    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch { /* sem corpo */ }
      done();
      throw errorFromStatus(res.status, text, path);
    }
    return { res, touch, done, fail };
  }

  /** POST simples: espera a resposta inteira e devolve o JSON. */
  async function post(path, body, signal) {
    const call = await request(path, body, signal);
    let text;
    try { text = await call.res.text(); } catch (err) { throw call.fail(err); } finally { call.done(); }
    try {
      return JSON.parse(text);
    } catch {
      throw new AgentError("bad_response", "O Foundry respondeu algo que não é JSON");
    }
  }

  /** Cria uma conversa nova no Foundry e devolve o id dela. */
  async function createConversation() {
    const data = await post("/openai/v1/conversations", {});
    if (!data.id) throw new AgentError("bad_response", "O Foundry não devolveu o id da conversa");
    return data.id;
  }

  // Formato atual do Foundry: { agent_reference: {...} }. Versões anteriores usavam { agent: {...} }.
  // Se o Foundry recusar um formato (400), o cliente tenta o outro uma vez e lembra qual funcionou.
  let agentField = "agent_reference";

  /** Chama a Responses API referenciando o agente; `call` é post (resposta inteira) ou request (streaming). */
  async function callAgent(call, conversationId, message, extra, signal) {
    const ref = { type: "agent_reference", name: agentName };
    if (agentVersion) ref.version = agentVersion;
    const bodyFor = (field) => ({ [field]: ref, conversation: conversationId, input: message, ...extra });
    try {
      return await call("/openai/v1/responses", bodyFor(agentField), signal);
    } catch (err) {
      if (!(err instanceof AgentError) || err.httpStatus !== 400 || err.code !== "unavailable") throw err;
      const other = agentField === "agent_reference" ? "agent" : "agent_reference";
      const result = await call("/openai/v1/responses", bodyFor(other), signal);
      agentField = other;
      return result;
    }
  }

  /** Confere a resposta completa do agente e devolve o texto. */
  function replyFrom(data) {
    if (data.status === "failed" || data.error) {
      throw new AgentError("unavailable", `O agente falhou: ${(data.error && (data.error.message || data.error.code)) || data.status}`);
    }
    const reply = extractReplyText(data);
    if (!reply) throw new AgentError("bad_response", "O agente respondeu sem texto");
    return reply;
  }

  /** Envia a mensagem do usuário ao agente, dentro da conversa, e devolve o texto da resposta (de uma vez). */
  async function sendMessage(conversationId, message, signal) {
    return replyFrom(await callAgent(post, conversationId, message, {}, signal));
  }

  // Se o Foundry recusar o streaming, o cliente passa a pedir a resposta inteira.
  let streamSupported = true;

  /**
   * Igual ao sendMessage, mas em streaming: chama onDelta(pedaço) a cada trecho de texto que chega.
   * O Foundry responde em Server-Sent Events (SSE): blocos "data: {json}" separados por linha em branco.
   * Os eventos que interessam: response.output_text.delta (pedaço do texto) e response.completed (fim).
   * Devolve o texto completo no final.
   */
  async function streamMessage(conversationId, message, onDelta, signal) {
    const whole = async () => {
      const reply = await sendMessage(conversationId, message, signal);
      onDelta(reply);
      return reply;
    };
    if (!streamSupported) return whole();

    let call;
    try {
      call = await callAgent(request, conversationId, message, { stream: true }, signal);
    } catch (err) {
      // 400 só no pedido com streaming: tenta sem. Se funcionar, não pede mais streaming.
      if (!(err instanceof AgentError) || err.httpStatus !== 400 || err.code !== "unavailable") throw err;
      const reply = await whole();
      streamSupported = false;
      return reply;
    }

    const { res, touch, done, fail } = call;
    try {
      // O Foundry ignorou o "stream" e mandou a resposta inteira em JSON.
      if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
        let data;
        try { data = JSON.parse(await res.text()); } catch { throw new AgentError("bad_response", "O Foundry respondeu algo que não é JSON"); }
        const reply = replyFrom(data);
        onDelta(reply);
        return reply;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let finalData = null;
      const handleEvent = (block) => {
        const dataLines = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        if (!dataLines.length || dataLines[0] === "[DONE]") return;
        let ev;
        try { ev = JSON.parse(dataLines.join("\n")); } catch { return; }
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string" && ev.delta) {
          text += ev.delta;
          onDelta(ev.delta);
        } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
          finalData = ev.response || null;
        } else if (ev.type === "response.failed" || ev.type === "error") {
          const e = (ev.response && ev.response.error) || ev.error || ev;
          throw new AgentError("unavailable", `O agente falhou: ${e.message || e.code || "erro no streaming"}`);
        }
      };
      for await (const chunk of res.body) {
        touch();
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          handleEvent(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
        }
      }
      if (buffer.trim()) handleEvent(buffer);

      if (!text && finalData) {
        // Não vieram pedaços, mas veio a resposta final completa.
        const reply = replyFrom(finalData);
        onDelta(reply);
        return reply;
      }
      if (!text.trim()) throw new AgentError("bad_response", "O agente respondeu sem texto");
      return text.trim();
    } catch (err) {
      throw fail(err);
    } finally {
      done();
    }
  }

  return { createConversation, sendMessage, streamMessage };
}

module.exports = { createFoundryClient, createTokenProvider, extractReplyText, AgentError, TOKEN_SCOPE };
