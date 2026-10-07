# Backend UniPass

## Ambiente local

1. Copie [`.env.example`](/d:/unipass/backend/.env.example) para `backend/.env`.
2. Ajuste `DATABASE_URL`, `JWT_SECRET` e, se precisar, as variaveis de SMS.
3. Suba a infraestrutura com `docker compose up -d postgres redis` na raiz do projeto.
4. Instale as dependencias com `npm install`.
5. Rode as migrations com `npx prisma migrate deploy`.
6. Se quiser dados iniciais, rode `npm run db:seed`.
7. Inicie a API com `npm run start:dev`.
8. Em outro terminal, inicie o worker com `npm run start:worker:dev`.

Por padrao a API sobe em `http://localhost:4000`.

## Variaveis importantes

- `FRONTEND_URLS`: lista separada por virgula com os dominios autorizados no CORS.
- `APP_TIMEZONE`: timezone oficial usada para calcular dia/horario das notificacoes.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`: configuracao da fila BullMQ.
- `NOTIFICATION_WORKER_CONCURRENCY`: quantidade de jobs processados em paralelo pelo worker.
- `EXPO_PUSH_API_URL`: endpoint do provider Expo Push. Padrao: `https://exp.host/--/api/v2/push/send`.
- `EXPO_PUSH_ACCESS_TOKEN`: token opcional para Expo Push Security, caso o projeto mobile exija autenticacao no provider.
- `BILLING_WEBHOOK_WORKER_CONCURRENCY`: quantidade de webhooks financeiros processados em paralelo pelo worker.
- `BILLING_WEBHOOK_PENDING_AGE_SECONDS`: idade minima, em segundos, para o cron reprocessar webhooks pendentes.
- `BILLING_WEBHOOK_RETRY_BATCH_SIZE`: quantidade maxima de webhooks pendentes reprocessados por minuto.
- `ASAAS_ENV`: `sandbox` ou `production`. Define que prefixo de chave as empresas podem salvar (`$aact_hmlg_` no sandbox, `$aact_prod_` em producao).
- `ASAAS_API_URL`: `https://api-sandbox.asaas.com/v3` (sandbox) ou `https://api.asaas.com/v3` (producao). Precisa ser https.
- `BILLING_ENCRYPTION_KEY`: chave mestra (32 bytes em base64, `openssl rand -base64 32`) que cifra a chave de API do Asaas de cada empresa no banco. Sem ela, nenhuma empresa consegue salvar a chave. Trocar o valor torna ilegiveis as chaves ja salvas (as empresas precisam salvar de novo).
- `ASAAS_WEBHOOK_PUBLIC_BASE_URL`: opcional. Endereco publico https da API (ex.: `https://api.seudominio.com`). Com ela, o botao "Cadastrar webhook" registra o webhook direto na conta Asaas da empresa; sem ela, a tela mostra URL + token para cadastro manual.
- `ASAAS_API_KEY`: nao e usada em tempo de execucao (cada empresa salva a propria chave pela tela "Gateway de cobranca").
- `ASAAS_WEBHOOK_TOKEN`: so para a rota legada `POST /billing/webhook/asaas`. Sem ela, a rota legada recusa tudo (401). A rota por empresa (`/billing/webhook/asaas/:endpointKey`) usa o token gerado na tela.
- `ASAAS_WEBHOOK_IP_WHITELIST`: lista separada por virgula com IPs autorizados a chamar os webhooks. Usa o IP da conexao (`req.ip`); atras de proxy, configure `trust proxy` antes de ligar.
- `COOKIE_SECURE`: use `true` em producao com HTTPS.
- `COOKIE_SAME_SITE`: use `none` quando frontend e backend estiverem em dominios diferentes e com HTTPS.
- `COOKIE_DOMAIN`: defina apenas se voce realmente precisar compartilhar cookie entre subdominios.
- `DEVICE_API_KEY`: chave obrigatoria para endpoints de IoT e telemetria via header `x-api-key`.

## Deploy

Configure no provedor do backend pelo menos:

```bash
PORT=4000
HOST=0.0.0.0
DATABASE_URL=postgresql://...
JWT_SECRET=...
FRONTEND_URLS=https://seu-frontend.com
APP_TIMEZONE=America/Sao_Paulo
REDIS_HOST=redis
REDIS_PORT=6379
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Se frontend e backend ficarem no mesmo dominio, voce pode manter `COOKIE_SAME_SITE=lax`.

## Push notifications

O backend agora expoe endpoints autenticados para o app mobile registrar subscriptions push por usuario:

- `GET /push-notifications/subscriptions`
- `POST /push-notifications/subscriptions`
- `POST /push-notifications/subscriptions/deactivate`

Quando um `NotificationPrompt` entra em dispatch, o worker tenta enviar push primeiro para subscriptions ativas e, se nao houver provider/token utilizavel, mantem o fallback atual via prompt pendente `IN_APP`.
