# Manager Dashboard

MAD runs a Next.js frontend and NestJS backend. Staff authentication/JWT handling
belongs to the sibling API gateway. Browser sockets run in the independent
[WebSocket service](../websocket/README.md), not the MAD application.

From the parent workspace run `docker compose up -d --build`. MAD is available at
http://localhost:3000. Root `.env` and `docker-compose.yml` configure the combined
stack; there is no MAD-only Compose file. Database SQL remains manual-only and
startup never creates/changes tables.

See [shared database setup](../documents/SHARED_DATABASE_SETUP.md),
[WebSocket integration](../documents/WEBSOCKET_SERVICE.md) and
[the document index](../documents/README.md).

MAD keeps source-event validation, reporting and its RabbitMQ publisher/ticket
adapter. The shared service owns connection authentication, one-use tickets,
permissions, subscriptions and browser event delivery. No UI contract changed.

For native development use Node 22.14+ and the package commands in `backend/` and
`frontend/`. Backend integration tests need a built sibling WebSocket checkout:
set `SHARED_WEBSOCKET_PATH` if it is not at `../../websocket` from `backend/`.
Unit tests do not require a running shared service. Never point integration tests
at Neon; use disposable TEST_DATABASE_URL and TEST_RABBITMQ_URL services.
