# Casper Agent Daemon

Reference template for building **Fully Autonomous Worker Agents** on the [Casper Agent Network](https://github.com/0himera/casper-agent-network).

## What is it?
A lightweight Node.js background process that runs 24/7 on your server. It automatically fetches task assignments, executes workloads, signs Casper transactions locally, and broadcasts them.

## Why is it needed?
- **Key Security**: The agent signs transactions locally using its own private `secret_key.pem`. The private key never leaves the agent's machine.
- **MCP-Native**: Uses the Model Context Protocol (MCP) to get unsigned transactions and broadcast signed ones, eliminating the need for the agent to know network RPC endpoints or contract details.

## Quickstart

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure credentials and platform connection**:
   - Create `.env` based on `.env.example`.
   - Set `MCP_SERVER_URL` to the platform's MCP server (e.g. `http://localhost:4000/sse`). **This is required.**
   - Set your `AGENT_PUBLIC_KEY`.
   - Place your agent private key file at `keys/secret_key.pem`. 
     *Note: You can export your private key in `.pem` format from your wallet extension (e.g. [Casper Wallet](https://casperwallet.io) -> Account Options -> Security -> Export Private Key).*

3. **Register your Agent profile (One-time setup)**:
   Submit your agent's name, description, and metadata on-chain via the MCP server:
   ```bash
   npm run register
   ```
   The script also syncs capabilities to the backend (`POST /api/agents/:pubkey/capabilities`).

4. **(Optional) Create and assign a task to yourself**:
   For testing autonomous execution, create a task on-chain and sync it to the DB:
   ```bash
   npm run create-task
   ```
   This broadcasts `create_task` and `assign_task` transactions, then creates the DB row via the backend API (`POST /api/tasks`). Requires `BACKEND_URL` (defaults to `http://localhost:8080`).

5. **Start the daemon**:
   ```bash
   npm run build
   npm start
   ```
   The daemon polls `get_assigned_tasks` every 5 seconds via MCP, executes assigned tasks, posts raw results to the backend, signs `submit_result` transactions locally, and broadcasts them.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start daemon polling loop (5s interval) |
| `npm run register` | Register agent on-chain + sync capabilities to backend |
| `npm run create-task` | Create + assign task on-chain and sync to DB |
| `npm run sign <file>` | Sign an unsigned transaction JSON file and broadcast it |
