# CLAUDE.md — Contexto Permanente do UniPass

> Este arquivo é o contexto persistente do projeto UniPass para trabalho assistido por IA.
> Ele é atualizado sempre que uma decisão arquitetural relevante é tomada.
> **Regra de ouro:** se o código contradiz este arquivo, o código é a fonte da verdade — e este arquivo deve ser corrigido.
>
> Última auditoria completa: 2026-09-17 (levantamento inicial, nenhuma alteração de código feita).

---

## 1. Visão geral

O UniPass é uma plataforma de gestão para empresas de **transporte escolar e de turismo**. Ela existe para unificar em um único sistema o que hoje costuma estar espalhado em planilhas, grupos de WhatsApp e controles manuais:

- cadastro de empresas, usuários, alunos, grupos, ônibus, rotas e horários;
- controle de acesso físico ao veículo via **TAG RFID**, com registro de embarque/desembarque;
- rastreamento de localização dos ônibus em tempo real;
- notificações (push e in-app) para pais/alunos sobre horários de rotas, com fluxo de confirmação de presença ("vai usar o transporte hoje?");
- cobrança financeira recorrente (mensalidades, materiais etc.), com integração planejada/parcial com o gateway **ASAAS**.
- é uma plataforma **multi-tenant**: cada empresa cliente (`Company`) só enxerga seus próprios dados.

O produto físico associado é o **UniHub**: um dispositivo IoT instalado no ônibus (ESP32 + leitor RFID + GPS + 4G + microSD + tela) que faz a ponte entre o mundo físico (aluno passando a TAG) e o backend do UniPass.

## 2. Arquitetura atual

```
                        ┌──────────────────────┐
                        │   Frontend (Next.js)  │  dashboard web
                        └──────────┬────────────┘
                                   │ REST (cookie httpOnly "token")
                        ┌──────────▼────────────┐
                        │   Backend (NestJS)     │  API + regras de negócio
                        │  - HTTP API (main.ts)  │
                        │  - Worker (worker.ts)  │  BullMQ (notificações, webhooks)
                        └──────┬───────────┬─────┘
                               │           │
                     ┌─────────▼───┐   ┌───▼─────────┐
                     │ PostgreSQL  │   │    Redis     │  (fila BullMQ)
                     │  (Prisma)   │   └──────────────┘
                     └─────────────┘
        ▲ (endpoints /iot/*, x-api-key)         ▲ (webhook + polling)
        │                                       │
┌───────┴────────┐                      ┌───────┴────────┐
│  UniHub (ESP32) │                      │  ASAAS (gateway) │
│ RFID + GPS + 4G │                      │  cobranças/boletos│
└─────────────────┘                      └──────────────────┘
```

- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + shadcn/ui. Um único app web (`frontend/`), sem app mobile no repositório ainda (roadmap do README menciona expansão para mobile).
- **Backend**: NestJS 11 modular (`backend/src/<modulo>`), um único serviço HTTP (`main.ts`) mais um **processo worker separado** (`worker.ts`) que consome filas BullMQ (notificações e processamento de webhooks de billing).
- **Banco de dados**: PostgreSQL 15, acessado via Prisma ORM 6. Um schema único, multi-tenant por coluna `companyId` (não há schema-per-tenant nem row-level security nativa do Postgres — o isolamento é feito na camada de aplicação).
- **Fila/cache**: Redis 7, usado pelo BullMQ para duas filas: `notifications` e `billing-webhook`.
- **Docker**: `docker-compose.yml` sobe 5 serviços: `postgres`, `redis`, `backend` (API), `backend-worker` (mesma imagem, entrypoint `worker.js`), `frontend`.
- **Serviços externos**:
  - **ASAAS** (gateway de cobrança) — hoje **apenas inbound**: o backend recebe e processa webhooks do ASAAS, mas não há nenhum client HTTP que chame a API do ASAAS para criar cobrança/cliente (ver seção 12 "Problemas conhecidos").
  - **Twilio** — envio de SMS de verificação no onboarding de empresas (opcional; sem config, cai em modo mock/dev).
  - **Expo Push API** — envio de notificações push para o app do usuário final.
- **Dispositivo IoT (UniHub)**: não há firmware no repositório; o backend expõe endpoints dedicados (`/iot/*`) autenticados por API key de dispositivo, que o firmware do UniHub (fora deste repo) consome.

## 3. Estrutura do repositório

```
unipass-dev/
├── backend/                  # API NestJS + worker + Prisma
│   ├── src/
│   │   ├── auth/             # login, JWT (cookie), guards, roles
│   │   ├── security/         # opaque IDs, CORS/origin guard, throttling
│   │   ├── companies/        # onboarding de empresa, planos, domínio de e-mail
│   │   ├── users/             # usuários internos (staff) da empresa
│   │   ├── students/          # alunos (cadastro central do transporte)
│   │   ├── groups/             # turmas/grupos de alunos
│   │   ├── buses/               # veículos
│   │   ├── devices/              # UniHub: pareamento, vínculo com ônibus
│   │   ├── rfid/                   # vínculo TAG RFID <-> aluno
│   │   ├── transport/               # embarque/desembarque (app e IoT)
│   │   ├── location/                 # telemetria de GPS do UniHub
│   │   ├── routes/ , route-schedules/ # rotas e horários
│   │   ├── confirmations/             # aluno confirma presença num horário
│   │   ├── notifications/             # cron que dispara prompts de notificação
│   │   ├── notification-prompts/      # ciclo de vida do prompt (pending/dispatched/answered)
│   │   ├── push-notifications/        # subscriptions + envio via Expo
│   │   ├── billing/                   # templates, cobranças, webhook ASAAS
│   │   ├── dashboard/                  # métricas e relatórios agregados
│   │   ├── queue/                       # BullMQ (filas + workers)
│   │   └── prisma/                       # PrismaService/Module
│   ├── prisma/schema.prisma            # schema único do banco
│   ├── prisma/seed.ts                   # massa de dados de desenvolvimento
│   └── worker.ts                        # entrypoint do processo worker
├── frontend/
│   └── src/
│       ├── app/dashboard/<recurso>/     # página + components/ + hooks/use<Recurso>.ts + types/
│       ├── app/contexts/                 # AuthContext, SidebarContext, ThemeContext
│       ├── components/ui/                 # design system (shadcn)
│       ├── lib/                            # permissions.ts, company-plans.ts, utils.ts
│       ├── services/api.ts                 # instância axios (cookie-based, withCredentials)
│       └── middleware.ts                    # redireciona /dashboard sem cookie -> /login
└── docker-compose.yml
```

## 4. Stack

- **Backend**: NestJS ^11, Prisma/`@prisma/client` ^6.19, PostgreSQL 15, Redis 7, BullMQ ^5.73, `@nestjs/jwt` + `passport-jwt`, `class-validator`/`class-transformer`, `@nestjs/throttler`, `@nestjs/schedule` (cron), bcrypt, TypeScript ^5.7.
- **Frontend**: Next.js 16.1.6 (App Router), React 19.2.3, Tailwind CSS ^4.2, shadcn/ui (`@base-ui/react`, `class-variance-authority`), axios, react-hook-form + zod, recharts (gráficos), maplibre-gl (mapa de localização), date-fns.
- **Infra**: Docker Compose, Postgres 15, Redis 7 (`appendonly` habilitado).
- **Testes**: Jest configurado no backend (`*.spec.ts`), poucos specs existentes hoje (`app.controller`, `auth.service`, `auth.controller`, `dashboard`, `security/opaque-id.service`) — cobertura ainda baixa.

## 5. Banco de dados

O schema (`backend/prisma/schema.prisma`) é único para todas as empresas; o isolamento multi-tenant é feito por uma coluna `companyId` em quase toda tabela, filtrada manualmente em cada `service.ts` (não há Row Level Security do Postgres nem middleware genérico do Prisma que injete esse filtro — ver riscos na seção 12).

### Entidades principais e o que significam no negócio

- **Company**: a empresa cliente (dona da operação de transporte). Tem `emailDomain` único — todo login de usuário/aluno daquela empresa deve usar e-mail `@dominio-da-empresa`. Tem `plan` (ESSENTIAL/GROWTH/SCALE) e um fluxo de solicitação de troca de plano (`requestedPlan` + campos de quem pediu) que só um `PLATFORM_ADMIN` pode aprovar.
- **User**: conta de acesso ao sistema (login). Tem `role` (`PLATFORM_ADMIN`, `ADMIN`, `DRIVER`, `COORDINATOR`, `USER`). Um `User` de papel `USER` representa o "responsável"/aluno logado e é sempre vinculado 1:1 a um `Student` (`studentId` único). `PLATFORM_ADMIN` não tem `companyId` — enxerga todas as empresas.
- **Student**: o aluno transportado. É o "hub" de relacionamento do domínio: pertence a um `Group`, pode ter um `BillingTemplate` (cobrança), várias `RfidCard`, participa de várias `Route` (N:N via `StudentRoute`), gera `TransportEvent` e pode ter um `User` de login associado.
- **Group**: turma/agrupamento de alunos (ex.: "Turma da Manhã"), usado para relatórios e agrupamento visual — não define rota nem cobrança diretamente.
- **Bus**: veículo. Tem `capacity` e placa única por empresa. Pode ter vários `Device` (UniHub) vinculados ao longo do tempo, mas o `Device` só aponta para um `Bus` por vez (relação Device→Bus é a "instalação atual").
- **Device**: o UniHub fisicamente. Identificado de forma imutável por `hardwareId` (gravado no firmware). Após o pareamento ganha `code`/`secret` (credenciais estáveis usadas nas chamadas `/iot/*`) e é vinculado a uma `Company`+`Bus`. Guarda também a última posição de GPS (`lastLat`/`lastLng`/`lastUpdate`).
- **RfidCard**: a TAG física, vinculada a um `Student` (pode existir "TAG órfã" sem aluno, ou desativada). `tag` é único globalmente.
- **TransportEvent**: o log de cada leitura de TAG no UniHub. `type` é `BOARDING`, `DEBOARDING`, `DENIED` (usados) ou `LEAVING` (definido no schema, mas **não usado em nenhum lugar do código atual** — ver seção 12). Cada evento referencia o `Device` que originou a leitura; `studentId`/`rfidCardId` podem ser nulos em eventos `DENIED` (TAG desconhecida).
- **Trip**: viagem de um ônibus. **Modelada no schema e usada em relatórios/seed, mas nenhum serviço do backend cria um `Trip` hoje** — é um recurso "morto"/planejado (ver seção 11 e 12).
- **Route / RouteSchedule / StudentRoute**: `Route` é a linha (ex. "Linha Centro → Escola"); `RouteSchedule` é um horário concreto daquela rota (tipo `GO`/`BACK`/`SHIFT`, dias da semana como bitlist `dayOfWeeks: Int[]`, horário de saída, e uma janela de notificação calculada — `notificationTimeMinutes`/`notificationDayOfWeeks` — via `schedule-metadata.util.ts`). `StudentRoute` é o N:N aluno↔rota.
- **ScheduleConfirmation**: resposta do usuário ("vou usar o transporte nesse horário?"), com chave de unicidade `(userId, scheduleId, occurrenceKey)` — `occurrenceKey` é uma data (`YYYY-MM-DD`) que identifica a ocorrência específica daquele horário recorrente.
- **NotificationPrompt**: o "convite" enviado ao usuário para confirmar presença; tem máquina de estados (`PENDING → DISPATCHED → ANSWERED/EXPIRED/FAILED`) e é o que de fato dispara o push.
- **PushSubscription**: token de push por dispositivo do usuário final (Expo/FCM/APNS — hoje só Expo está implementado no envio).
- **CompanyBillingSettings / BillingTemplate / BillingCustomer / BillingCharge / BillingEventLog**: módulo financeiro. `CompanyBillingSettings` guarda se a empresa usa gateway próprio (`EXTERNAL`) ou o "gateway da plataforma" (`PLATFORM_GATEWAY`, via ASAAS) e o status de onboarding financeiro. `BillingTemplate` é um "grupo de cobrança" recorrente (valor, dia de vencimento, recorrência) vinculável a alunos. `BillingCharge` é uma cobrança individual gerada a partir de um template. `BillingEventLog` é o log bruto e idempotente de eventos recebidos do ASAAS (dedupe por `deduplicationKey`, com advisory lock do Postgres para processamento concorrente seguro).

### Constraints/índices que carregam regra de negócio

- `Company.cnpj` e `Company.emailDomain` são únicos → uma empresa por CNPJ e por domínio de e-mail.
- `User.email` único globalmente (não só por empresa) — e-mails de empresas diferentes não podem colidir.
- `Student` é único por `(registration, companyId)` e por `(companyId, email)`.
- `Bus` é único por `(plate, companyId)` — placas podem repetir entre empresas diferentes.
- `Device.hardwareId`, `Device.pairingCode`, `Device.code` são únicos globalmente — um UniHub físico nunca pode ser reaproveitado por duas empresas ao mesmo tempo.
- `BillingCharge` é único por `(companyId, externalReference)` — é essa combinação que permite casar um webhook do ASAAS com a cobrança certa quando o `gatewayChargeId` ainda não está preenchido.
- `PushSubscription` é único por `(provider, token)` e por `(provider, installationKey)` — evita duplicar subscription do mesmo dispositivo físico.

## 6. Regras de negócio (descobertas no código)

- **Isolamento por empresa**: praticamente todo serviço recebe `companyId` do usuário autenticado (do JWT) e filtra manualmente `where: { companyId }`. Não existe um guard/interceptor genérico que garanta isso — é responsabilidade de cada `service.ts` (risco listado na seção 12).
- **E-mail de empresa**: usuários e alunos criados por um `ADMIN` precisam ter e-mail terminando em `@<emailDomain da empresa>` (`normalizeCompanyEmail`/`normalizeStudentEmail`). É assim que o sistema garante que todo login pertence à empresa certa.
- **Papéis (`UserRole`)**: `PLATFORM_ADMIN` (dono da plataforma, gerencia empresas/planos, sem `companyId`), `ADMIN` (gestor da empresa cliente, CRUD completo dentro da empresa), `COORDINATOR` e `DRIVER` (operação: veem embarques, ônibus, localização), `USER` (responsável/aluno, só vê o que é seu — próprias cobranças, próprios horários).
- **Pareamento do UniHub** (fluxo completo, ver seção 10): o dispositivo nasce "órfão" (sem empresa) com apenas `hardwareId`; ganha um `pairingCode` temporário (10 min de validade); um `ADMIN` no painel usa esse código para vincular o device a uma `Company`+`Bus`; só então o device recebe `code`/`secret` permanentes para autenticar chamadas futuras.
- **Embarque/desembarque**: uma TAG só é aceita se pertencer a um `Student` **ativo** da **mesma empresa** do `Device` que fez a leitura; qualquer tentativa fora disso vira um `TransportEvent` do tipo `DENIED` (auditoria de tentativas inválidas). Um aluno não pode ter dois `BOARDING` seguidos sem um `DEBOARDING` no meio, no mesmo `Device` (o serviço olha o último evento daquele aluno+device).
- **"Primeiro e segundo boarding do dia"**: a tela de "Retorno do dia" (dashboard/boarding) não usa `DEBOARDING` para decidir quem já foi para casa — ela conta **quantos `BOARDING`s** o aluno teve no dia. O 1º `BOARDING` é a ida (casa → escola); o 2º `BOARDING` do mesmo dia é interpretado como a volta (escola → casa). Isso é uma regra de negócio implícita no `TransportService.getDailyBoardingOverview`, não documentada em comentário — importante não quebrar sem entender o impacto na tela de embarque.
- **Cobrança (billing)**: um aluno só pode ser associado a um `BillingTemplate` compatível com seu papel (`targetScope` inclui `STUDENTS`). A emissão de cobranças (`issueCharges`) é feita em lote por mês de referência, evita duplicar cobrança do mesmo aluno+template no mesmo mês, e marca como `SCHEDULED` (se a data de emissão é futura) ou `ISSUED` (se já é hoje/passado); um cron horário (`releaseScheduledCharges`) promove `SCHEDULED → ISSUED` quando a data chega. **Importante**: isso só cria o registro local da cobrança — não emite boleto real no ASAAS (ver seção 12).
- **Visibilidade financeira**: apenas `ADMIN` vê a visão consolidada de cobranças da empresa inteira; os demais papéis (`DRIVER`, `COORDINATOR`, `USER`) só veem cobranças cujo `ownerUserId` é o próprio usuário.
- **Notificações de horário**: um cron por minuto (`NotificationsService.handleNotifications`) varre `RouteSchedule`s ativos cujo `notificationTimeMinutes` bate com o minuto atual (no timezone `APP_TIMEZONE`, padrão America/Sao_Paulo) e cria/enfileira um `NotificationPrompt` por aluno ativo da rota. O prompt expira automaticamente se não for respondido até o horário de saída.
- **Solicitação de troca de plano**: um `ADMIN` só pode *pedir*; só um `PLATFORM_ADMIN` pode efetivamente aplicar (`applyRequestedPlan`).

## 7. Fluxos principais

**A) Usuário do painel → dado no banco**
```
Browser (Next.js) → axios (cookie httpOnly "token") → NestJS Controller
  → Guards (Throttler → CookieOriginGuard → JwtAuthGuard → RolesGuard)
  → Service (filtra por companyId do JWT) → PrismaService → PostgreSQL
```

**B) TAG RFID → evento de transporte**
```
Aluno aproxima TAG do leitor → UniHub lê a TAG
  → UniHub monta payload { code, secret, rfidTag } (credenciais do pareamento)
  → 4G → POST /iot/transport/boarding (ou /deboarding)  [Public + InternalApiKeyGuard x-api-key]
  → TransportService.registerIotBoarding: valida code+secret do device,
    busca RfidCard+Student da mesma empresa do device, valida estado (ativo, não duplicado)
  → cria TransportEvent (BOARDING/DEBOARDING) ou DENIED
  → resposta autorizada/negada volta pro UniHub (para acender LED/mostrar na tela)
  → Dashboard/telas de embarque leem TransportEvent via API autenticada (JWT)
```

**C) UniHub → localização em tempo real**
```
GPS do UniHub → POST /location/telemetry { code, secret, latitude, longitude }
  [Public + InternalApiKeyGuard]
  → LocationService valida credenciais, grava lastLat/lastLng/lastUpdate no Device
  → Painel web consulta GET /location/buses/:busId/live (JWT)
  → LocationService decide estado: "live" (< 45s), "stale", "needs-pairing", "no-online-device"
```

**D) Notificação de horário → confirmação do responsável**
```
Cron (a cada minuto) → NotificationsService acha RouteSchedules no minuto de notificar
  → NotificationPromptsService cria/atualiza NotificationPrompt (idempotente por occurrenceKey)
  → enfileira job na fila "notifications" (BullMQ/Redis)
  → Worker process (worker.ts) consome o job → PushNotificationsService envia push (Expo)
  → app do usuário exibe prompt → usuário responde → ScheduleConfirmation é gravada
```

**E) Webhook do ASAAS → atualização de cobrança**
```
ASAAS → POST /billing/webhook/asaas (Public; valida access-token + HMAC + IP allowlist)
  → grava BillingEventLog bruto (idempotente por deduplicationKey)
  → enfileira job na fila "billing-webhook"
  → Worker process processa: acha a BillingCharge (por gatewayChargeId ou externalReference),
    usa advisory lock do Postgres, atualiza status/paidAt/urls, marca evento como processado
  → cron de retry (a cada minuto) reprocessa eventos que falharam ao enfileirar
```

## 8. Autenticação e autorização

- **Login**: `POST /auth/login` (público, rate-limited) valida e-mail+senha (bcrypt), gera um JWT e o grava em **cookie httpOnly** (`token`), nunca devolvido no corpo da resposta. `rememberMe` muda o tempo de expiração do cookie/JWT.
- **IDs opacos no JWT**: o payload do JWT não guarda o UUID puro do usuário/empresa; passa por `OpaqueIdService` (HMAC-assinado, prefixo `opk_`) tanto no `sub` quanto no `companyId`. O mesmo serviço tem interceptors globais (`OpaqueIdRequestInterceptor`/`OpaqueIdResponseInterceptor`) que decodificam/codificam automaticamente campos `id`/`*Id`/`ids` no corpo de requests e responses de toda a API — ou seja, o frontend e o firmware nunca veem UUIDs reais de tabela, só esses tokens opacos. Isso é uma camada de "não vazar IDs sequenciais/enumeráveis", não uma camada de autorização.
- **Guards globais** (aplicados em `main.ts` a toda a API, nessa ordem): `SecurityThrottlerGuard` (rate limit por IP) → `CookieOriginGuard` (bloqueia cross-site request usando o cookie de sessão fora dos origins de `FRONTEND_URLS`, tipo uma proteção CSRF baseada em `sec-fetch-site`/`Origin`/`Referer`) → `JwtAuthGuard` (exige JWT válido, exceto rotas `@Public()`) → `RolesGuard` (exige um dos `@Roles(...)` do handler, se declarado).
- **Autenticação de dispositivo (UniHub)**: dois esquemas coexistem:
  - `InternalApiKeyGuard` (header `x-api-key` == `DEVICE_API_KEY` do servidor) protege os endpoints de pareamento (`/iot/devices/pairing/*`), transporte (`/iot/transport/*`) e telemetria (`/location/telemetry`) — ou seja, qualquer UniHub "de fábrica" com a API key consegue chamar esses endpoints.
  - Dentro desses endpoints, o **device individual** se autentica com `code`+`secret` próprios (gerados no pareamento), comparados com `safeCompareStrings` (comparação em tempo constante).
- **Isolamento entre empresas**: não há guard central — cada `service.ts` recebe `req.user.companyId` e usa como filtro obrigatório do Prisma. `PLATFORM_ADMIN` é o único papel sem `companyId`, e as rotas que ele acessa (`/companies`, `/companies/:id/apply-requested-plan`) não filtram por empresa (são "cross-tenant" por natureza).
- **Frontend**: `middleware.ts` só verifica a *presença* do cookie `token` (não valida o JWT) para decidir redirecionar `/dashboard/*` ↔ `/login` — é só UX, a segurança real está nos guards do backend. `AuthContext` busca `/auth/me` no client para saber o usuário/role real e mostrar modal de "sessão expirada" em qualquer 401.

## 9. Integrações externas

- **ASAAS** (gateway de cobrança): hoje é **somente um consumidor de webhooks** — `POST /billing/webhook/asaas`, com validação de segurança em 3 camadas (token de acesso, assinatura HMAC do corpo bruto, IP allowlist opcional). Mapeia eventos ASAAS (`PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE` etc.) para o enum interno `BillingChargeStatus`. **Não existe client de saída** para a API do ASAAS (criar customer, criar cobrança/boleto) — ver "Problemas conhecidos".
- **Twilio** (SMS): usado só no onboarding público de empresa (`sendSmsCode`/`verifySmsCode`), para verificar o telefone do responsável antes de criar a empresa. Sem `TWILIO_*` configurado, cai em modo simulado (`developmentCode` retornado na resposta) — só permitido fora de produção.
- **Expo Push API** (`https://exp.host/--/api/v2/push/send`): usado para enviar as notificações push de confirmação de horário. É o único provider (`PushNotificationProvider`) realmente implementado, embora o schema já preveja `FCM`/`APNS`.

## 10. UniHub (dispositivo IoT)

Não há firmware no repositório — o que existe é a API que o UniHub consome, e o modelo de dados que o representa (`Device`).

- **Identificação**: cada UniHub tem um `hardwareId` gravado de fábrica/firmware (imutável, único).
- **Pareamento** (fluxo completo):
  1. UniHub liga e chama `POST /iot/devices/pairing/start { hardwareId }` (API key). Se é a primeira vez, o backend cria um `Device` "órfão" e gera um `pairingCode` de 6 caracteres válido por 10 minutos.
  2. O `pairingCode` é exibido na telinha do UniHub.
  3. Um `ADMIN` da empresa, no painel web, digita esse código e escolhe o `Bus` de destino → `POST /devices/link` (JWT, role `ADMIN`). O backend vincula o `Device` à `Company` do admin e ao `Bus` escolhido, e gera `code`+`secret` permanentes (se ainda não existirem).
  4. O UniHub fica dando poll em `POST /iot/devices/pairing/claim { hardwareId, pairingCode }` até receber `credentialsReady: true` — a resposta traz `code`+`secret`, que o firmware deve persistir (provavelmente no microSD) para uso dali em diante.
- **Autenticação operacional**: todas as chamadas subsequentes do UniHub (embarque, desembarque, telemetria) usam `code`+`secret` no corpo da requisição, comparados com `safeCompareStrings`. Um device com `active: false` ou sem `companyId` é rejeitado.
- **Associação com ônibus**: um `Device` aponta para no máximo um `Bus` por vez (`Device.busId`); pode ser re-vinculado a outro ônibus por um `ADMIN` (`PATCH /devices/:id/bus`).
- **RFID**: o UniHub envia apenas a string da TAG lida (`rfidTag`); toda a lógica de "quem é o aluno" e "pode embarcar" vive no backend (`TransportService`), não no dispositivo.
- **GPS**: telemetria simples (`latitude`/`longitude`) via `POST /location/telemetry`; o backend guarda só a última posição conhecida (não há histórico de trajeto no schema atual — `Device.lastLat/lastLng/lastUpdate` são sobrescritos a cada chamada). Um device é considerado "online/live" se teve telemetria nos últimos 45 segundos.
- **4G**: é o transporte de rede assumido (não há nada no backend específico de 4G — é responsabilidade do firmware/modem).
- **Tela**: usada para mostrar o `pairingCode` e provavelmente feedback de embarque (autorizado/negado) — o contrato disso com o backend é apenas a resposta HTTP de `/iot/transport/boarding` (`status: AUTHORIZED`, nome do aluno, timestamp).
- **Comportamento offline / sincronização**: **não há nada implementado no backend para isso hoje** — não existe endpoint de "sync em lote" nem campo de idempotência para eventos enviados atrasados (ex.: um `TransportEvent` criado por um UniHub que ficou offline e reenviou depois usaria o timestamp do servidor, não um timestamp do dispositivo). Se o UniHub grava no microSD para sincronizar depois, esse contrato **ainda precisa ser desenhado** — tratar como funcionalidade planejada, não existente.

## 11. Estado atual (funcional vs. planejado)

**Funcional (ponta a ponta, com uso real de dados):**
- Autenticação, RBAC por papel, isolamento multi-tenant manual.
- Onboarding público de empresa (com verificação SMS opcional/mock).
- CRUD de empresas, usuários, alunos, grupos, ônibus, rotas, horários, TAGs RFID.
- Pareamento de UniHub, vínculo com ônibus.
- Registro de embarque/desembarque via `/iot/transport` e via painel (`/transport`), com log de tentativas negadas.
- Telemetria de localização e visualização "ao vivo" no mapa do painel.
- Dashboard com métricas e 5 relatórios (movimentação, frequência de alunos, frota, rotas, grupos).
- Notificações de horário (cron → fila → push Expo) e confirmação de presença pelo usuário.
- Recebimento e processamento idempotente/seguro de webhooks do ASAAS (infraestrutura muito robusta: advisory locks, dedupe, retry, staleness check).
- Emissão local de cobranças por template (sem envio real ao gateway).

**Parcialmente funcional / com lacuna conhecida:**
- **Cobrança via ASAAS**: existe todo o modelo de dados e o recebimento de webhook, mas **falta o client de saída** que efetivamente cria o customer/cobrança no ASAAS. Hoje `issueCharges` só cria o registro local; sem uma chamada de criação real, o `gatewayChargeId`/boleto nunca existiriam de fato em produção, e os webhooks não teriam o que casar.
- **Push notifications**: schema prevê `FCM` e `APNS`, mas só `EXPO` está implementado no envio (`sendExpoNotifications`).

**Planejado / modelado mas não implementado:**
- **`Trip`** (viagem) e o `EventType.LEAVING`: existem no schema e são referenciados em queries de relatório/dashboard e no seed, mas **nenhum serviço cria um `Trip` ou emite um evento `LEAVING`** hoje. Os contadores de "viagens" no dashboard ficam permanentemente zerados em dados reais.
- **Sincronização offline do UniHub**: sem contrato definido (ver seção 10).
- **App mobile**: mencionado no README/roadmap, sem código no repositório.

**Legado / a revisar:**
- `backend/src/auth/dto/jwt-auth.guard.ts`: arquivo que só re-exporta `JwtAuthGuard` de `../jwt-auth.guard` — usado por engano em alguns imports (`transport.controller.ts`, `rfid.controller.ts`) em vez do caminho canônico `src/auth/jwt-auth.guard.ts`. Funciona, mas é confuso (guard não é um DTO).

## 12. Problemas conhecidos

- **Sem client de saída para o ASAAS**: maior gap do módulo financeiro — ver seção 11. Precisa decidir se será implementado (chamando a API REST do ASAAS para criar customer/payment) antes de considerar billing "pronto para produção".
- **Isolamento multi-tenant é manual, não estrutural**: cada `service.ts` precisa lembrar de filtrar por `companyId`. Não há teste automatizado nem middleware que garanta isso — um novo endpoint escrito sem esse cuidado vazaria dados entre empresas. Candidato a virar uma regra de arquitetura (ex.: helper/decorator obrigatório, ou revisão de checklist).
- **Desafios SMS em memória**: `CompaniesService.smsChallenges` é um `Map` em memória do processo. Não sobrevive a restart e **não funciona com mais de uma réplica do backend** (o código de verificação pode ser gerado numa instância e verificado em outra). Vira bug real assim que a API escalar horizontalmente.
- **`RfidController` sem `RolesGuard`**: `POST /rfid/link` só exige `JwtAuthGuard` (qualquer papel autenticado), enquanto endpoints equivalentes de outros módulos (devices, students) exigem `ADMIN`. Vale confirmar se é intencional (ex.: `DRIVER` vincular TAG em campo) ou uma lacuna de autorização.
- **Hard delete inconsistente**: `BusesService.deleteMany` e `StudentsService.deleteMany` fazem `prisma.*.deleteMany` (exclusão física), enquanto a maioria das outras entidades (users, groups, routes, devices, route-schedules, billing templates) usa soft delete (`active: false`). Isso quebra histórico (ex.: um `TransportEvent` referenciando um `Student` ou `Bus` excluído fisicamente) e é inconsistente com o padrão dominante do resto do sistema.
- **`Trip`/`LEAVING` mortos no código, vivos no schema**: risco de relatórios "mentirem" (mostrar zero viagens) sem deixar claro que a feature não está implementada.
- **`backend/src/auth/dto/jwt-auth.guard.ts`**: duplicidade de import path (ver seção 11), puramente cosmético mas gera confusão.
- **Revisão de segurança do login (2026-09-18, testada contra a API):** o que está correto — sem cookie ou com assinatura adulterada a API responde 401; o token vai só em cookie `HttpOnly; SameSite=Lax` (nunca no corpo); o JWT carrega id opaco, e-mail, nome, role e empresa (nunca senha); `/auth/me` e `/users` não expõem `password`; `CookieOriginGuard` devolve 403 para `Sec-Fetch-Site: cross-site` e Referer externo; login limitado a 10/min por IP. Pontos a corrigir: (1) **JWT não é revogável** — logout só apaga o cookie, um token roubado vale até o `exp` (1h, ou 30 dias com "manter conectado"); candidato a denylist no Redis ou refresh token curto. (2) **Enumeração de usuário por tempo de resposta** no login: e-mail inexistente responde em ~7 ms, senha errada em ~55 ms (bcrypt só roda quando o usuário existe) — fazer um `bcrypt.compare` contra um hash fixo quando o usuário não existe. (3) Origin não permitido pelo CORS gera **500** (o callback do `enableCors` lança `Error`) em vez de 403 — bloqueia, mas polui logs. (4) `COOKIE_SECURE=false` e `NEXT_PUBLIC_API_URL=http://…` são só para dev: em produção o cookie precisa de `Secure` e a API de HTTPS, senão e-mail/senha do `POST /auth/login` trafegam em texto puro na rede (foi isso que apareceu ao interceptar o tráfego local). (5) Sem `helmet`/headers de segurança e com `X-Powered-By: Express` exposto. (6) Sem `trust proxy`: atrás de um reverse proxy o rate limit passa a contar todos os clientes como um único IP. (7) `.env` define `COOKIE_MAX_AGE_MS`, mas o código lê `COOKIE_REMEMBER_MAX_AGE_MS` (variável ignorada). (8) Senha mínima de 6 caracteres, sem outros critérios.
- **`middleware.ts` do frontend não valida o JWT**: apenas checa presença do cookie. Não é um bug de segurança (a API valida de verdade), mas pode gerar UX ruim (usuário "logado" no client vendo `/dashboard` renderizar e só depois recebendo 401 das chamadas).

## 13. Decisões arquiteturais

| Decisão | Motivo | Alternativas consideradas | Impacto |
|---|---|---|---|
| JWT em cookie httpOnly + `CookieOriginGuard` customizado (em vez de CSRF token clássico) | Evitar XSS roubando o token (não fica acessível via JS) mantendo proteção contra CSRF checando `sec-fetch-site`/Origin/Referer | Bearer token em header + localStorage; CSRF token clássico | Login não pode ser feito via `curl` simples sem replicar os headers de origem; simplifica o client (axios com `withCredentials`) |
| IDs opacos (`OpaqueIdService`) via interceptors globais | Não expor UUIDs internos/sequência de criação para o cliente/dispositivo | Expor UUID cru (mais simples, comum em APIs internas) | Todo endpoint precisa ser compatível com o transform automático de campos `*Id`/`ids`; debugging fica mais indireto (é preciso decodificar o opaque id) |
| Multi-tenant por coluna `companyId` em schema único (em vez de schema-per-tenant) | Simplicidade operacional (uma única migração, um único banco) | Schema por tenant; banco por tenant | Isolamento depende 100% de disciplina de código (ver "Problemas conhecidos") |
| Worker separado (`worker.ts`) para filas BullMQ, rodando fora do processo HTTP | Não travar requests HTTP com processamento de notificações/webhooks; permite escalar workers independente da API | Processar tudo inline no request; usar apenas cron sem fila | Exige Redis como dependência de infraestrutura; exige rodar 2 containers (`backend` e `backend-worker`) |
| ASAAS como *apenas webhook receiver* por enquanto | (inferido do código — não documentado explicitamente) | Implementar client de saída completo desde já | Módulo de billing não é utilizável ponta a ponta em produção ainda |

## 14. Roadmap

- **Curto prazo**: decidir o que fazer com o gap do client ASAAS (implementar ou isolar melhor como "não pronto"); decidir sobre `Trip`/`LEAVING` (implementar de verdade ou remover do schema); revisar autorização do `RfidController`; padronizar soft vs. hard delete.
- **Médio prazo**: mover desafios de SMS para Redis (ou tabela) para suportar múltiplas réplicas; endurecer isolamento multi-tenant (ex.: testes de regressão cross-tenant, ou abstração central de "repositório escopado por empresa"); desenhar sincronização offline do UniHub.
- **Longo prazo** (conforme README do projeto): expansão para app mobile; monitoramento/alertas operacionais mais avançados; aprofundar segurança e governança de acesso conforme a base de clientes crescer.

## 15. Últimas alterações (changelog de sessões)

- **2026-09-18 (login + cadastro)**: `frontend/src/app/login/page.tsx` e `frontend/src/app/cadastro/empresa/page.tsx` refeitos na mesma linguagem visual da landing, **sem alteração de comportamento**: mesmas chamadas (`/auth/login`, `/companies/domain-check`, `/companies/onboarding/sms/send|verify`, `/companies/onboarding`), mesmas validações por etapa, "manter conectado" (localStorage + `rememberMe`), modal de erro 401/genérico, sugestões de domínio, código de desenvolvimento do SMS, planos e tela de sucesso. Novos componentes compartilhados em `frontend/src/components/auth/`: `AuthShell.tsx` (header com logo, voltar e toggle de tema; layout opcional com painel lateral), `fields.tsx` (`Field`, `FieldMessage`, classes de botão/input) e `LiveFeed.tsx` (painel de eventos simulados exibido no login em telas grandes, rotulado como simulação). O carrossel de screenshots com zoom do login antigo foi removido (as imagens em `public/unipass/*.png` continuam no repositório, sem uso). Observado em teste: com `SMS_PROVIDER=twilio` configurado mas sem credenciais válidas, o backend responde "Não foi possível enviar o SMS de verificação agora." — comportamento do backend, não da tela.

- **2026-09-17 (landing v2 — interativa)**: após feedback ("pobre, sem interação, só escolar"), a landing foi refeita como uma página interativa que cobre três segmentos: **transporte escolar, fretamento/turismo e transporte público**. Dependência nova no frontend: `motion` (Framer Motion v13, import `motion/react`). Estrutura em `frontend/src/components/marketing/landing/`: `segments.ts` (copy por segmento), `LandingHeader.tsx`, `CityHero.tsx` (mapa SVG de cidade com ônibus animados via SMIL, abas de segmento com pill animada, hover em veículo mostra card "ao vivo" e pausa a animação do SVG, parallax por mouse, contadores de demonstração rotulados como simulação), `BoardingSimulator.tsx` (arrastar TAG RFID até um UniHub desenhado; reproduz as regras reais de `TransportService`: TAG sem cadastro → DENIED, embarque duplicado → "já está a bordo", desembarque sem embarque → negado; modos embarque/desembarque; lotação e log de eventos), `DayTimeline.tsx` (linha do tempo horizontal dirigida pelo scroll em desktop, scroll nativo em mobile) e `Ledger.tsx` (lista expansível do que entra no painel). `ThemeToggle.tsx` usa `useSyncExternalStore` para saber se já montou e evitar hydration mismatch (o `ThemeProvider` lê `localStorage` no estado inicial — problema latente que também pode afetar o `Topbar` do dashboard). `RouteVisual.tsx` (v1) removido. Rotas `/login` e `/cadastro/empresa` mantidas; dados exibidos são fictícios e rotulados como simulação.

- **2026-09-17**: primeira auditoria técnica completa do repositório (nenhuma alteração de código). Estrutura de pastas, módulos do backend, schema do banco, autenticação/autorização, fluxo UniHub (pareamento, embarque, telemetria), módulo financeiro e integração ASAAS mapeados em detalhe. `CLAUDE.md` criado com o resultado. Principais achados registrados nas seções 11 e 12 (gap de client ASAAS, `Trip`/`LEAVING` não implementados, isolamento multi-tenant manual, inconsistência soft/hard delete, SMS challenge em memória).
