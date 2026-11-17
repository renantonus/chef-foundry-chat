/**
 * Configuração do servidor.
 * Lê o arquivo .env (sem pacote extra) e monta um objeto com tudo que o back end precisa.
 * Nenhum valor secreto fica no código: tudo vem de variáveis de ambiente.
 */
"use strict";
const fs = require("fs");
const path = require("path");

/** Carrega KEY=VALOR do .env para process.env, sem sobrescrever o que já existe. */
function loadEnvFile(file = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(file)) return;
  const values = {};
  // Remove o BOM que alguns editores do Windows colocam no começo do arquivo.
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    // Se a mesma variável aparecer duas vezes, uma linha vazia não apaga a preenchida.
    if (value || values[key] === undefined) values[key] = value;
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Monta a configuração a partir das variáveis de ambiente. */
function getConfig(env = process.env) {
  return {
    // No PC, escuta só em 127.0.0.1 (ninguém da rede acessa). Publicado no Azure App Service
    // (que define WEBSITE_SITE_NAME), precisa escutar em todas as interfaces.
    host: env.HOST || (env.WEBSITE_SITE_NAME ? "0.0.0.0" : "127.0.0.1"),
    port: parseInt(env.PORT, 10) || 3000,
    // Endpoint do PROJETO no Foundry, ex.: https://<recurso>.services.ai.azure.com/api/projects/<projeto>
    endpoint: (env.FOUNDRY_PROJECT_ENDPOINT || "").trim().replace(/\/+$/, ""),
    agentName: (env.FOUNDRY_AGENT_NAME || "").trim(),
    agentVersion: (env.FOUNDRY_AGENT_VERSION || "").trim(), // opcional: sem valor, usa a versão mais recente
    timeoutMs: parseInt(env.AGENT_TIMEOUT_MS, 10) || 60000,
    maxMessageLength: parseInt(env.MAX_MESSAGE_LENGTH, 10) || 1000,
    rateLimitPerMinute: parseInt(env.RATE_LIMIT_PER_MINUTE, 10) || 20,
    // Resposta aparecendo aos poucos. STREAMING=off volta para a resposta de uma vez só.
    streaming: String(env.STREAMING || "on").trim().toLowerCase() !== "off"
  };
}

/** Lista as variáveis obrigatórias que estão faltando. */
function missingConfig(config) {
  const missing = [];
  if (!config.endpoint) missing.push("FOUNDRY_PROJECT_ENDPOINT");
  if (!config.agentName) missing.push("FOUNDRY_AGENT_NAME");
  return missing;
}

module.exports = { loadEnvFile, getConfig, missingConfig };
