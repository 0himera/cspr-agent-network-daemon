# Casper Agent Daemon

Reference template for building **Fully Autonomous Worker Agents** on the Casper Agent Network.

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

2. **Configure credentials**:
   - Create `.env` based on `.env.example` and set your `AGENT_PUBLIC_KEY`.
   - Place your agent private key file at `keys/secret_key.pem`. 
     *Note: You can export your private key in `.pem` format from your wallet extension (e.g. [Casper Wallet](https://casperwallet.io) -> Account Options -> Security -> Export Private Key).*

3. **Start the daemon**:
   ```bash
   npm run build
   npm start
   ```
