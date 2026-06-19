# Integração de calendário

> **Convites nativos Outlook/Teams (Microsoft Graph):** veja [OUTLOOK-GRAPH.md](./OUTLOOK-GRAPH.md) — é a forma de enviar convite `.ics` direto pela Microsoft, **além** da SoftwareAI.

# Integração SoftwareAI (Outlook / Teams via painel)

## Domínio da API

| Uso | URL |
|-----|-----|
| **Produção (requisições)** | `https://xltw-api6-8lww.b2.xano.io/api:5ONttZdQ` |
| **Documentação** | `https://docs.softwareai.cloud` |

O Farol já usa o Xano como proxy da API SoftwareAI (WhatsApp + Calendário).  
Autenticação: header `Authorization: Bearer <token>`.

Endpoints usados:

- `GET /calendar` — lista calendários da conta
- `GET /calendar/avaibleTimeSlots?calendarId=...` — horários livres
- `POST /calendar/events` — criar evento (`event_id: 0`)
- `GET /calendar/events` — listar eventos
- `DELETE /calendar/events` — remover eventos

## Uma conta Outlook basta?

Sim, na prática **uma conta conectada na SoftwareAI** com permissão para criar eventos nos calendários dos assessores.

Você **não** precisa do login/senha de cada assessor no código. O fluxo é:

1. Cada assessor tem um **calendário registrado** na plataforma (retornado em `GET /calendar`).
2. Ao agendar, o `POST /calendar/events` usa o `calendar` = ID daquele assessor.
3. O campo `guests` define os participantes:
   - **E-mail** → convite nativo do Outlook/Teams (`.ics` / aceitar-recusar no calendário Microsoft)
   - **Telefone** (`+55...`) → lembrete via WhatsApp da SoftwareAI (quando `notificationEnabled: true`), não é o convite Outlook em si
4. O evento sempre aparece no calendário Outlook do assessor (dono do `calendarId`), pois a conta Microsoft está conectada na SoftwareAI.

## Configuração determinística

### 1. Token da conta Farol/Techfala

No `.env` (servidor, **nunca** no front):

```env
CALENDAR_API_TOKEN=seu_token_aqui
CALENDAR_API_BASE_URL=https://xltw-api6-8lww.b2.xano.io/api:5ONttZdQ
CALENDAR_TECHFALA_TITLE_HINT=techfala
```

### 2. Sincronizar mapa assessor → calendarId

```bash
cd "/root/farol formulario"
CALENDAR_API_TOKEN=... npm run calendars:sync
```

Isso gera `src/data/calendar-map.json` cruzando:

- calendários da API (`informations.title`)
- assessores da planilha Google (`Nome Completo` / `Nome no Sistema`)

Assessores sem match ficam com `calendarId: null` — é preciso criar o calendário na SoftwareAI e rodar o sync de novo.

### 3. Subir app com proxy

```bash
# Desenvolvimento
CALENDAR_API_TOKEN=... npm run start   # terminal 1 — proxy :3006
npm run dev                            # terminal 2 — Vite :3005

# Produção (Docker)
docker build -t farol-formulario .
docker run -e CALENDAR_API_TOKEN=... -p 80:80 farol-formulario
```

## Observação sobre o token atual no n8n

O token encontrado no workflow **Harmony** retorna apenas o calendário **"Dra Gabriele" (id 1353)** — conta de outro cliente.

Para Farol, use o token da conta onde os calendários dos assessores e o calendário **Techfala** estiverem cadastrados.
