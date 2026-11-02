# Backend UniPass

## Ambiente local

1. Na raiz do projeto, copie [`../.env.example`](../.env.example) para `.env` (usuario, senha e banco do container do Postgres).
2. Copie [`.env.example`](.env.example) para `backend/.env` e preencha as linhas sem `#`. O arquivo explica cada variavel e como gerar os segredos.
3. Suba a infraestrutura com `docker compose up -d postgres redis` na raiz do projeto.
4. Instale as dependencias com `npm install`.
5. Rode as migrations com `npx prisma migrate deploy`.
6. Se quiser dados iniciais, rode `npm run db:seed`.
7. Inicie a API com `npm run start:dev`.
8. Em outro terminal, inicie o worker com `npm run start:worker:dev`.

Por padrao a API sobe em `http://localhost:4000`.

## Variaveis de ambiente

Todas as variaveis que o backend le estao em [`.env.example`](.env.example): obrigatoria ou opcional, padrao, para que serve e se o valor e so de desenvolvimento. Linhas sem `#` sao para preencher ou conferir; linhas `# NOME=valor` sao opcionais e mostram o padrao do codigo.

O teste `src/env-example.spec.ts` (roda no `npm test`) falha se o codigo ler uma variavel que nao esta no `.env.example`, ou se o arquivo listar uma que ninguem le. Quem passar a ler uma variavel nova coloca ela la, com comentario.

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
