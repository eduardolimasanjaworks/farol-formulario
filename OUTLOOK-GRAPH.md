# Convites nativos Outlook / Teams (Microsoft Graph)

O Farol pode enviar convites **direto na Microsoft**, além do evento na SoftwareAI.

## Duas camadas (TAMBÉM, não em vez de)

| Camada | O que faz | Credencial |
|--------|-----------|------------|
| **SoftwareAI** | Agenda conectada no painel deles + WhatsApp | `CALENDAR_API_TOKEN` (já configurado) |
| **Microsoft Graph** | Convite `.ics` / aceitar no Outlook + link Teams | App no **Azure AD** (`MS_GRAPH_*`) |

## Por que precisa do Azure?

A Microsoft **não permite** criar convites Outlook sem autenticação OAuth. O token SoftwareAI não substitui o Graph.

Com o app Azure, o servidor Farol chama:

```
POST https://graph.microsoft.com/v1.0/users/{email-do-assessor}/events
```

com `attendees` = e-mail do cliente → o Exchange envia o convite oficial.

## Configuração (uma vez)

1. Acesse [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Anote **Tenant ID** e **Client ID**.
3. **Certificates & secrets** → novo client secret.
4. **API permissions** → **Microsoft Graph** → **Application permissions**:
   - `Calendars.ReadWrite` (criar evento na agenda de cada assessor)
5. **Grant admin consent** (obrigatório para application permission).
6. No `.env` do Farol:

```env
MS_GRAPH_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_GRAPH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_GRAPH_CLIENT_SECRET=seu_secret
VITE_OUTLOOK_GRAPH_ENABLED=true
```

7. Reinicie o servidor: `npm run start`

## Comportamento no envio do SDR

1. Cria evento na **SoftwareAI** (calendário do assessor mapeado).
2. Se Graph configurado → cria evento no **Outlook do assessor** (e-mail da planilha) e convida o **cliente por e-mail**.
3. Se Graph falhar e `VITE_OUTLOOK_GRAPH_STRICT=false` (padrão), o WhatsApp/SoftwareAI segue; o erro fica em `outlookError`.
4. Se `VITE_OUTLOOK_GRAPH_STRICT=true`, qualquer falha no Outlook bloqueia o envio.

## Requisitos

- E-mail do assessor na planilha = mesmo **UPN** do Microsoft 365 (`douglas@farolcapital.com.br`).
- E-mail do cliente na planilha de clientes (coluna **E-mail**) para receber convite Outlook.
- Contas no tenant Azure da Farol/Techfala.

## Testar

```bash
curl http://localhost:3006/api/calendar/health
# outlookGraph: true

curl -X POST http://localhost:3006/api/outlook/invite \
  -H 'Content-Type: application/json' \
  -d '{
    "assessorEmail": "douglas@farolcapital.com.br",
    "assessorName": "Douglas",
    "clienteName": "Teste",
    "clienteEmail": "cliente@exemplo.com",
    "isoDate": "2026-06-15",
    "horario": "10:00",
    "title": "[TESTE] Reunião Farol",
    "description": "Pode apagar"
  }'
```

O cliente deve receber convite no Outlook; o assessor vê o evento na agenda dele.
