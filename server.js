/**
 * Ponto de entrada: `npm start`.
 * Lê o .env, cria o cliente do agente no Foundry e sobe o servidor.
 */
"use strict";
const http = require("http");
const { loadEnvFile, getConfig, missingConfig } = require("./server/config");
const { createFoundryClient, createTokenProvider } = require("./server/foundry");
const { createApp } = require("./server/app");

loadEnvFile();
const config = getConfig();
const missing = missingConfig(config);

const client = createFoundryClient({
  endpoint: config.endpoint,
  agentName: config.agentName,
  agentVersion: config.agentVersion,
  getToken: createTokenProvider(),
  timeoutMs: config.timeoutMs
});

const server = http.createServer(createApp({ config, client }));

server.listen(config.port, config.host, () => {
  console.log("");
  console.log(`  Chef de Geladeira Vazia rodando em http://localhost:${config.port}`);
  console.log(`  Agente no Foundry: ${config.agentName || "(não configurado)"}`);
  if (missing.length) {
    console.log(`  ATENÇÃO: faltam variáveis no .env: ${missing.join(", ")}`);
    console.log("  Copie o .env.example para .env e preencha antes de conversar.");
  }
  console.log("  Para parar: Ctrl + C");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`A porta ${config.port} já está em uso. Troque o PORT no .env.`);
  else console.error(err);
  process.exit(1);
});
