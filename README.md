# Manager Dashboard

MAD contains the Next.js manager frontend, NestJS backend and the current shared
WebSocket implementation. Staff authentication is provided by the sibling API gateway.

Start the combined local stack from the parent workspace:

```powershell
cd ..
docker compose up -d --build
```

Local configuration is in the parent `.env` and `docker-compose.yml`.
Open the dashboard at http://localhost:3000.

Documents have moved to [the root documents directory](../documents/README.md).
See [local setup](../documents/local-development.md),
[database differences](../documents/database-review/README.md),
[MAD reference documents](../documents/mad/reference/README.md), and
[final deliverables](../documents/mad/deliverables/).

The old `docs/` and `documents/` directories and local Compose file no longer live here.
No startup migrations or schema synchronization run. MAD only inserts the configured
initial manager when absent and preserves existing accounts.

For native development, run package commands from `backend/` and `frontend/`.
Tests must use disposable test services, never a hosted application database.
