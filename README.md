# Chef de Geladeira Vazia · interface web do agente no Microsoft Foundry

Aplicação web de chat para o agente **Chef de Geladeira Vazia** (no Foundry: `automatenan`). O agente cria receitas só com os ingredientes que a pessoa já tem em casa, mais sal, óleo e água, para economizar dinheiro e tempo e reduzir o desperdício de comida.

**Público:** estudantes e pessoas que moram sozinhas, quem tem pouco tempo ou pouca experiência na cozinha e famílias que querem aproveitar sobras.

Todas as respostas exibidas vêm do agente publicado no Microsoft Foundry, chamado pelo back end deste projeto.

![Tela inicial do Chef de Geladeira Vazia](docs/tela-inicial.png)

Conversa real com o agente `automatenan` no Foundry (ele pergunta restrições, tempo, porções e utensílios antes de montar a receita, como mandam as instruções do agente):

![Conversa real com o agente no Foundry](docs/conversa-real.png)

"Minha geladeira", que monta o pedido com ingredientes e preferências:

![Minha geladeira: montador de pedido](docs/minha-geladeira.png)

## Arquitetura

```mermaid
flowchart LR
  A[Navegador<br/>front end] -- "POST /api/chat<br/>{ message, conversationId }" --> B[Back end Node<br/>proxy]
  B -- "token Entra ID<br/>(fica só no servidor)" --> C[Microsoft Foundry<br/>agente automatenan]
  C -- resposta --> B
  B -- "{ reply, conversationId }" --> A
```

1. O navegador envia a mensagem para o **nosso** back end (`POST /api/chat`). O front end não conhece o endpoint do Foundry e não tem nenhuma chave.
2. O back end valida a mensagem (texto, não vazia, até 1000 caracteres) e pega um token do **Microsoft Entra ID** com o `DefaultAzureCredential` (escopo `https://ai.azure.com/.default`).
3. Na primeira mensagem, o back end cria uma conversa no Foundry (`POST {endpoint}/openai/v1/conversations`) e devolve o `conversationId` ao navegador.
4. O navegador chama `POST /api/chat/stream` e recebe a resposta aos poucos. O back end pede a resposta ao Foundry com `"stream": true` e repassa cada pedaço de texto. Se o Foundry recusar o streaming, o back end pede a resposta inteira e o chat continua funcionando. A rota `POST /api/chat` (resposta de uma vez) continua disponível.
5. Cada mensagem vai para o agente pela Responses API (`POST {endpoint}/openai/v1/responses`), com a referência ao agente (`"agent_reference": { "type": "agent_reference", "name": "automatenan" }`) e o mesmo `conversationId`. É isso que mantém o contexto entre as mensagens (multi-turno).
6. O botão **Nova conversa** descarta o `conversationId`, e a próxima mensagem cria outra conversa.

| Componente | Responsabilidade |
| --- | --- |
| Front end (`public/`) | Chat, carregamento, erros, nova conversa, histórico, tema, exibição das respostas em markdown |
| Back end (`server/`) | Variáveis de ambiente, autenticação no Foundry, chamada ao agente, validação, limites, tratamento de erros |
| Microsoft Foundry | Executa o agente `automatenan` (modelo `gpt-5-mini`) com as instruções e a base de conhecimento |

## Funcionalidades

| Requisito | Como foi atendido |
| --- | --- |
| RF1 Tela de chat | Campo de mensagem, botão de envio e histórico com as mensagens do usuário e do agente |
| RF2 Integração real | `server/foundry.js` chama o agente no Foundry pelo back end |
| RF3 Multi-turno | `conversationId` criado uma vez e reutilizado a cada mensagem |
| RF4 Carregamento | "O Chef está pensando…", aviso depois de 12 s e resposta aparecendo aos poucos; o botão de enviar vira "Parar" |
| RF5 Erros amigáveis | Agente indisponível (503), demora excessiva (504), falha de rede (502), limite de uso (429), sem internet; botão "Tentar de novo" |
| RF6 Nova conversa | Botão no topo |
| RF7 Responsivo | Testado em celular (390 px) e computador (1280 px) |
| RF8 Identidade visual | Nome, cores terracota, ilustração e boas-vindas do Chef |
| Extras do enunciado | Resposta em streaming, markdown nas respostas, sugestões clicáveis, histórico de conversas, 👍/👎 por resposta, modo escuro |

### Recursos da versão 2

| Recurso | O que faz |
| --- | --- |
| Resposta em streaming | O texto do Chef aparece aos poucos. O botão de enviar vira "Parar" e interrompe a resposta |
| Minha geladeira | Monta a mensagem com ingredientes clicáveis, número de pessoas, tempo, utensílios, restrições e alergias. O Chef recebe tudo de uma vez e não precisa perguntar antes |
| Respostas rápidas | Depois de cada resposta, sugestões de continuação ("Me dá outra opção", "Tem como fazer mais rápido?") |
| Receitas salvas | Botão "Salvar" em cada resposta; as receitas ficam na aba "Receitas", com copiar, imprimir e apagar |
| Timers de cozinha | Os tempos da receita ("5 minutos") viram botões que iniciam uma contagem regressiva com aviso sonoro |
| Lista de ingredientes | Tocar num ingrediente risca o que já foi separado |
| Ouvir e ditar | Lê a resposta em voz alta e escreve a mensagem pela voz (quando o navegador tem esses recursos) |
| Compartilhar, imprimir e baixar | Compartilha ou imprime uma receita e baixa a conversa em `.txt` |

Timers, voz, receitas salvas e a "Minha geladeira" rodam só no navegador. Nada disso passa pelo servidor nem muda a forma de falar com o agente.

## Pré-requisitos

- **Node.js 20** ou mais novo: https://nodejs.org
- **Azure CLI**: https://learn.microsoft.com/cli/azure/install-azure-cli
- Uma conta com acesso ao projeto do Foundry. Para chamar o agente por código, a conta precisa do papel **Azure AI User** (ou superior) no projeto.

## Como instalar e executar

1. Instale as dependências:
   ```
   npm install
   ```
2. Faça login no Azure com a mesma conta do Foundry:
   ```
   az login
   ```
3. Copie o `.env.example` para `.env` e preencha (veja a próxima seção).
4. Rode:
   ```
   npm start
   ```
5. Abra **http://localhost:3000**.

No Windows, depois dos passos 2 e 3, também dá para dar dois cliques em `iniciar.bat`: ele instala as dependências, sobe o servidor e abre o navegador.

## Publicar na internet (Azure App Service)

No PC, o token do agente vem do `az login`. Num servidor isso não existe, então a aplicação publicada usa **Managed Identity**: o próprio Azure entrega o token à aplicação. Assim **não há senha nem chave em lugar nenhum** — nem no código, nem nas configurações do site.

Os comandos abaixo rodam no PowerShell, dentro da pasta do projeto, com o `az login` já feito. Troque `chef-de-geladeira` por um nome livre (ele vira o endereço do site).

1. **Crie o site e publique** (plano gratuito F1):
   ```
   az webapp up --name chef-de-geladeira --runtime "NODE:20-lts" --sku F1 --location brazilsouth
   ```
   O `.env` e o `node_modules` não sobem: estão no `.gitignore`, que o comando respeita. As dependências são instaladas no servidor.

2. **Ligue a Managed Identity** e guarde o id dela:
   ```
   $principal = az webapp identity assign --name chef-de-geladeira --query principalId --output tsv
   ```

3. **Dê a permissão mínima no projeto do Foundry.** O papel é o **Foundry Agent Consumer**, que só deixa conversar com o agente, sem poder alterá-lo:
   ```
   $assinatura = az account show --query id --output tsv
   $escopo = "/subscriptions/$assinatura/resourceGroups/<grupo>/providers/Microsoft.CognitiveServices/accounts/<recurso>/projects/<projeto>"
   az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role "eed3b665-ab3a-47b6-8f48-c9382fb1dad6" --scope $escopo
   ```
   `<grupo>`, `<recurso>` e `<projeto>` aparecem na página de visão geral do projeto no portal do Foundry.

4. **Configure as variáveis do site:**
   ```
   az webapp config appsettings set --name chef-de-geladeira --settings FOUNDRY_PROJECT_ENDPOINT="https://<recurso>.services.ai.azure.com/api/projects/<projeto>" FOUNDRY_AGENT_NAME="automatenan"
   ```

5. Abra `https://chef-de-geladeira.azurewebsites.net`. A permissão pode levar alguns minutos para valer; se aparecer erro de autenticação, espere e recarregue.

### Antes de deixar o site público

Um site aberto deixa qualquer pessoa conversar com o agente, e cada mensagem consome a cota da assinatura. Duas proteções:

- O limite de mensagens por minuto por usuário já está ligado (`RATE_LIMIT_PER_MINUTE`).
- Para restringir quem entra, ligue a autenticação do próprio App Service (no portal: **Authentication → Add identity provider → Microsoft**). Aí só quem tem conta da organização abre o site, e nenhuma linha de código muda.

## Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `FOUNDRY_PROJECT_ENDPOINT` | Sim | Endpoint do projeto no Foundry, no formato `https://<recurso>.services.ai.azure.com/api/projects/<projeto>`. Fica na página inicial do projeto no portal |
| `FOUNDRY_AGENT_NAME` | Sim | Nome do agente no Foundry |
| `FOUNDRY_AGENT_VERSION` | Não | Fixa uma versão do agente; vazio usa a mais recente |
| `PORT` | Não | Porta do servidor (padrão 3000) |
| `AGENT_TIMEOUT_MS` | Não | Tempo máximo esperando o agente (padrão 60000) |
| `MAX_MESSAGE_LENGTH` | Não | Tamanho máximo da mensagem (padrão 1000) |
| `RATE_LIMIT_PER_MINUTE` | Não | Mensagens por minuto por usuário (padrão 20) |
| `STREAMING` | Não | `on` (padrão) mostra a resposta aos poucos; `off` devolve a resposta de uma vez |
| `HOST` | Não | Endereço onde o servidor escuta. No PC é `127.0.0.1`; publicado no App Service passa a ser `0.0.0.0` sozinho |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Raramente | Login por service principal, para hospedagem fora do Azure. No App Service não são necessários: a Managed Identity resolve |

## Testes

```
npm test
```

São 29 testes automáticos do back end. Eles usam um **Foundry falso** (`tests/mock-foundry.js`) só para conferir o comportamento do servidor sem gastar cota: validação, multi-turno, conversa expirada, demora, erros do agente, falha de rede, falta de login, limite de uso, formato antigo do Foundry, streaming (pedaços, multi-turno, recusa do Foundry, falha no meio, desligado), privacidade dos logs, cabeçalhos de segurança, endereço de escuta e ausência de segredos no front end. A aplicação em si sempre fala com o Foundry de verdade.

## Diagnóstico da conexão

Se o chat mostrar "O Chef está indisponível", o motivo real aparece no terminal do servidor (linha `[agente] falha: ...`). Para testar a conexão com o Foundry passo a passo, rode:

```
node diagnostico.js
```

Ele mostra a conta do Azure usada, cria uma conversa e testa os formatos de chamada ao agente, exibindo a resposta completa do Foundry em cada um (sem mostrar o token).

## Estrutura de pastas

```
├── public/                 front end (servido pelo back end)
│   ├── index.html
│   ├── css/style.css
│   ├── img/                ícone e ilustração
│   └── js/
│       ├── app.js          chat, streaming, histórico, receitas salvas, erros, tema
│       ├── montador.js     "Minha geladeira": monta a mensagem com ingredientes e preferências
│       ├── cozinha.js      timers, lista de ingredientes, ouvir e ditar
│       ├── markdown.js     markdown seguro (escapa HTML antes)
│       └── theme.js        aplica o tema salvo
├── server/
│   ├── app.js              rotas /api/chat, /api/chat/stream, /api/health, /api/feedback e arquivos estáticos
│   ├── foundry.js          token do Entra ID, conversas, Responses API e streaming
│   ├── validate.js         validação da mensagem
│   └── config.js           leitura do .env
├── tests/                  testes do back end e Foundry falso
├── docs/                   imagens do README
├── server.js               ponto de entrada (npm start)
├── diagnostico.js          teste da conexão com o Foundry
├── .env.example
└── iniciar.bat
```

## Decisões técnicas

- **Credenciais só no servidor.** O front end conversa apenas com `/api/chat`. Não há endpoint, token ou chave em nenhum arquivo de `public/` (um teste confere isso).
- **Sem chave em lugar nenhum.** O `DefaultAzureCredential` usa o login do `az login` no PC e a Managed Identity quando publicado no Azure. Nos dois casos não existe senha para guardar: nem no código, nem no `.env`, nem nas configurações do site.
- **Servidor com o Node puro (`http`).** Uma dependência só (`@azure/identity`), menos coisa para instalar e para explicar.
- **Chamada REST em vez do SDK do projeto.** As rotas `/openai/v1/conversations` e `/openai/v1/responses` deixam explícito o que acontece em cada passo.
- **Token em cache.** O token é reaproveitado até 5 minutos antes de expirar, para não pedir um novo a cada mensagem.
- **Erros sem detalhes técnicos para o usuário.** O detalhe vai só para o log do servidor.
- **Privacidade.** Os logs registram só método, rota, status e tempo; nunca o texto das mensagens. O histórico de conversas fica só no navegador de quem usa. O 👍/👎 envia só o voto, sem o conteúdo.
- **Custos.** Modelo `gpt-5-mini`, limite de 20 mensagens por minuto por usuário e de 1000 caracteres por mensagem.
- **Segurança da página.** Content-Security-Policy restrita (só scripts e estilos do próprio site), o markdown escapa todo HTML antes de formatar e o servidor bloqueia acesso a arquivos fora de `public/`.
- **Formato da chamada ao agente.** A documentação do Foundry mudou durante o projeto: o campo antigo `agent` passou a ser `agent_reference`. O back end usa o formato atual e, se o Foundry recusar com erro 400, tenta o outro uma vez e lembra qual funcionou.
- **Streaming com reserva.** O back end lê os eventos do Foundry (Server-Sent Events) e repassa ao navegador uma linha de JSON por pedaço. O tempo limite de 60 s vale para o intervalo entre pedaços. Se o Foundry recusar o streaming, o servidor passa a pedir a resposta inteira sem o usuário perceber. `STREAMING=off` desliga.
- **Botão "Parar".** Quando o usuário interrompe, o navegador fecha a conexão e o back end cancela a chamada ao Foundry, para não gastar à toa.
- **Recursos de cozinha no navegador.** Timers, voz e receitas salvas usam recursos do próprio navegador, sem bibliotecas e sem enviar dados ao servidor.
- **Conversa expirada.** Se o Foundry não encontrar a conversa salva no navegador, o back end começa outra e avisa o usuário.

## Limitações conhecidas

- Ditado por voz e leitura em voz alta dependem do navegador (funcionam no Chrome e no Edge; o ditado não existe no Firefox).
- As receitas salvas e as escolhas da "Minha geladeira" ficam só no navegador.
- Os timers param se a página for fechada.
- O histórico de conversas fica salvo só no navegador; em outro aparelho ele não aparece.
- O limite de mensagens por minuto fica na memória do servidor e zera quando ele reinicia.

## Créditos e referências

- [@azure/identity](https://www.npmjs.com/package/@azure/identity) (Microsoft): autenticação no Entra ID.
- [Papéis do Microsoft Foundry (RBAC)](https://learn.microsoft.com/azure/foundry/concepts/rbac-foundry): papel Foundry Agent Consumer usado na publicação.
- [Managed identity no Azure App Service](https://learn.microsoft.com/azure/app-service/overview-managed-identity).
- Documentação do Microsoft Foundry: [quickstart de agentes](https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-agent) e [exemplos REST de Responses e Conversations](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/function-calling).
