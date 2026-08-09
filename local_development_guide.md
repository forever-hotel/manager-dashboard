# Forever Hotel - Manager Dashboard (MAD) Development Guide

This guide explains how the Docker Compose architecture works, how it manages environment variables and secrets, and how you can run the system both fully containerized and manually for local development.

---

## 1. How Docker Compose Runs

The `docker-compose.yml` file is the orchestrator for your local development environment. It defines three interconnected services that run in isolated containers:

1. **`postgres` (Database)**: A PostgreSQL 15 database instance. It mounts a Docker volume (`postgres_data`) so that your data persists even if you stop or delete the container.
2. **`mad-backend` (NestJS)**: The backend API. It builds from the `backend/Dockerfile`. It uses a `depends_on` rule to ensure it waits for the `postgres` database to be healthy before attempting to connect and run migrations.
3. **`mad-frontend` (Next.js)**: The frontend user interface. It builds from the `frontend/Dockerfile` and passes the API URL as a build argument so the browser knows where to send requests.

All three containers are placed on an internal virtual network called `mad-network`. This allows them to communicate with each other using their service names as hostnames (e.g., the backend connects to the database via `postgres:5432`).

---

## 2. How Secrets & Environment Variables are Handled

Docker Compose handles secrets through **environment variable substitution** and **fallback defaults**.

If you look at the `docker-compose.yml` file, you will see syntax like this:
```yaml
JWT_SECRET=${JWT_SECRET:-change-me-in-production}
```

### Here is how it evaluates this:
1. **Host Environment:** It first checks if your terminal/OS has an environment variable named `JWT_SECRET` exported.
2. **Root `.env` File:** If not, it looks for a file named `.env` in the exact same directory as the `docker-compose.yml` file.
3. **Fallback Default:** If it still can't find it, it uses the fallback value provided after the `:-` symbol (in this case, `change-me-in-production`).

> [!WARNING]
> **Production Security**
> In a production environment, you should never rely on the fallback defaults in the `docker-compose.yml`. You should inject these secrets securely using GitHub Secrets via your CI/CD pipeline, or provide a strictly controlled `.env` file on the production server.

---

## 3. Running the Stack (Two Options)

Depending on what you are trying to achieve, you can run the stack in two different ways.

### Option A: Fully Containerized (Best for testing the final build)

This option spins up the entire application exactly as it would run in production.

1. Open a terminal in the root directory (where `docker-compose.yml` is).
2. Run the following command to build and start everything:
   ```bash
   docker-compose up -d --build
   ```
3. To view the live logs of your application, run:
   ```bash
   docker-compose logs -f
   ```
4. Access the application:
   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:4000`
5. To stop the application:
   ```bash
   docker-compose down
   ```

### Option B: Manual Execution (Best for Active Development)

This is the standard workflow for active coding. You run the database in Docker, but you run the Node.js applications natively on your Windows machine so you get instant Hot Module Replacement (HMR) and better debugging.

**Step 1: Start the Database**
Open a terminal in the root directory and start *only* the postgres container:
```bash
docker-compose up -d postgres
```

**Step 2: Start the Backend (NestJS)**
1. Ensure your local configuration is set up:
   ```bash
   cd backend
   cp .env.example .env
   ```
   *(Note: I already did this for you in the previous step. Your `.env` points to `localhost:5432`)*
2. Install dependencies and start the server:
   ```bash
   npm install
   npm run start:dev
   ```

**Step 3: Start the Frontend (Next.js)**
1. Ensure your local configuration is set up:
   ```bash
   cd frontend
   cp .env.example .env.local
   ```
2. Install dependencies and start the server:
   ```bash
   npm install
   npm run dev
   ```

> [!TIP]
> **Database Conflicts**
> If you switch between Option A and Option B, be mindful of your database connection strings. When running manually (Option B), the backend reaches the database via `localhost:5432`. When running inside Docker (Option A), the backend reaches the database via `postgres:5432`.
