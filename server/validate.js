/**
 * Validação do que o navegador envia, ANTES de repassar ao agente.
 * Regras: mensagem em texto, não vazia, com tamanho máximo; id da conversa opcional e com formato seguro.
 */
"use strict";

const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * @returns {{ok: true, message: string, conversationId: string|null} | {ok: false, status: number, error: string}}
 */
function validateChatBody(body, maxLength) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Formato inválido. Envie um JSON com o campo \"message\"." };
  }
  if (typeof body.message !== "string") {
    return { ok: false, status: 400, error: "O campo \"message\" precisa ser um texto." };
  }
  // Remove caracteres de controle invisíveis (mantém quebra de linha e tab).
  const message = body.message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!message) return { ok: false, status: 400, error: "A mensagem está vazia." };
  if (message.length > maxLength) {
    return { ok: false, status: 400, error: `A mensagem passou do limite de ${maxLength} caracteres.` };
  }
  let conversationId = null;
  if (body.conversationId !== undefined && body.conversationId !== null && body.conversationId !== "") {
    if (typeof body.conversationId !== "string" || !CONVERSATION_ID.test(body.conversationId)) {
      return { ok: false, status: 400, error: "Identificador de conversa inválido." };
    }
    conversationId = body.conversationId;
  }
  return { ok: true, message, conversationId };
}

module.exports = { validateChatBody };
