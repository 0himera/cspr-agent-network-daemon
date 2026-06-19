import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { PublicKey, PrivateKey, Transaction, KeyAlgorithm, HttpHandler, RpcClient } from 'casper-js-sdk';

dotenv.config();
// Also load platform server env so the local MCP server has database credentials when run via Stdio
dotenv.config({ path: path.resolve(__dirname, '../../app/server/.env') });

const AGENT_PRIVATE_KEY_PATH = process.env.AGENT_PRIVATE_KEY_PATH || './keys/secret_key.pem';
const AGENT_PUBLIC_KEY = process.env.AGENT_PUBLIC_KEY || '';
const POLLING_INTERVAL_MS = 5000;

async function executeSkillMock(domain: string, prompt: string): Promise<string> {
  console.log(`[Agent] Executing skill for domain [${domain}] with prompt: "${prompt}"`);
  // Simulate LLM execution
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const response = `[MOCK RESULT] Analysis for DeFi Domain: ${domain}.\nPrompt received: ${prompt}\nExecution completed at: ${new Date().toISOString()}`;
  return response;
}

// Global flag to prevent concurrent task execution runs
let isProcessing = false;

async function pollTasks(mcpClient: Client) {
  if (isProcessing) return;
  
  try {
    const response = (await mcpClient.callTool({
      name: 'get_assigned_tasks',
      arguments: { agentPublicKey: AGENT_PUBLIC_KEY }
    })) as any;

    if (!response.content || response.isError) {
      console.error(`❌ Failed to poll assigned tasks: ${JSON.stringify(response)}`);
      return;
    }

    const tasks = JSON.parse(response.content[0].text);
    if (tasks.length > 0) {
      isProcessing = true;
      console.log(`\n🔔 Found ${tasks.length} assigned task(s). Starting execution...`);
      
      for (const task of tasks) {
        const taskId = task.id;
        console.log(`\nProcessing Task: ${taskId}`);
        console.log(`Domain: ${task.domain}`);
        console.log(`Prompt: "${task.prompt}"`);

        // A. Execute task logic
        const executionResult = await executeSkillMock(task.domain, task.prompt);
        console.log(`[Agent] Output generated: \n--- \n${executionResult}\n---`);

        // B. Calculate hash
        const resultHash = crypto.createHash('sha256').update(executionResult).digest('hex');
        console.log(`Result Hash (SHA-256): ${resultHash}`);

        // C. Save raw result to validator (Hackathon shortcut)
        const rustBackendUrl = process.env.RUST_BACKEND_URL || 'http://localhost:3000';
        console.log(`Posting raw result to backend API...`);
        try {
          const apiRes = await fetch(`${rustBackendUrl}/api/tasks/${taskId}/raw_result`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Agent-Pubkey': AGENT_PUBLIC_KEY
            },
            body: JSON.stringify({ result: executionResult })
          });
          if (apiRes.ok) {
            console.log('✅ Raw result successfully saved to backend.');
          } else {
            console.error(`⚠️ Backend returned status ${apiRes.status} saving raw result`);
          }
        } catch (e: any) {
          console.error(`⚠️ Failed to post raw result to backend: ${e.message}`);
        }

        // D. Request unsigned transaction
        console.log('Requesting unsigned transaction from MCP...');
        const submitTxRes = (await mcpClient.callTool({
          name: 'submit_execution_result',
          arguments: {
            senderHex: AGENT_PUBLIC_KEY,
            taskId: taskId,
            resultHash: resultHash
          }
        })) as any;

        if (!submitTxRes.content || submitTxRes.isError) {
          console.error(`❌ Failed to get submit transaction: ${JSON.stringify(submitTxRes)}`);
          continue;
        }

        const unsignedTxData = JSON.parse(submitTxRes.content[0].text);

        // E. Sign transaction locally
        if (!fs.existsSync(AGENT_PRIVATE_KEY_PATH)) {
          console.warn(`\n⚠️ Local Signing Skipped: Private key file not found at ${AGENT_PRIVATE_KEY_PATH}.`);
          continue;
        }

        console.log(`Signing transaction locally using ${AGENT_PRIVATE_KEY_PATH}...`);
        const privateKeyPem = fs.readFileSync(AGENT_PRIVATE_KEY_PATH, 'utf8');
        let privateKey: PrivateKey;
        try {
          privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.ED25519);
        } catch {
          privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.SECP256K1);
        }

        const transaction = Transaction.fromJSON(unsignedTxData.transaction);
        transaction.sign(privateKey);
        const signedTxJson = transaction.toJSON();

        // F. Broadcast transaction
        console.log('Broadcasting signed transaction to Casper network...');
        const nodeUrl = process.env.CASPER_NODE_URL || 'https://node.testnet.casper.network/rpc';
        let transactionHash: string;
        try {
          console.log(`Connecting to Casper node RPC at: ${nodeUrl}...`);
          const rpcHandler = new HttpHandler(nodeUrl);
          const rpcClient = new RpcClient(rpcHandler);
          const result = await rpcClient.putTransaction(transaction);
          transactionHash = result.transactionHash.toHex ? result.transactionHash.toHex() : (result.rawJSON.transaction_hash.Version1 || result.transactionHash);
          console.log('✅ Broadcasted successfully via RpcClient.');
        } catch (err: any) {
          console.warn(`⚠️ RpcClient broadcast failed: ${err.message || err}. Trying direct HTTP JSON-RPC POST fallback...`);
          // Fallback: direct HTTP POST to JSON-RPC endpoint
          const response = await fetch(nodeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(),
              method: 'account_put_transaction',
              params: {
                transaction: {
                  Version1: signedTxJson
                }
              }
            })
          });
          const resJson = (await response.json()) as any;
          if (resJson.error) {
            throw new Error(`Direct RPC call failed: ${JSON.stringify(resJson.error)}`);
          }
          transactionHash = resJson.result.transaction_hash.Version1;
          console.log('✅ Broadcasted successfully via direct HTTP POST.');
        }

        console.log(`\n🎉 Transaction successfully broadcasted for task ${taskId}!`);
        console.log(`Transaction Hash: ${transactionHash}`);
      }
      
      isProcessing = false;
    }
  } catch (err: any) {
    console.error('Error during task polling loop:', err.message || err);
    isProcessing = false;
  }
}

async function main() {
  console.log('=== Casper Autonomous Agent Daemon Starting (Polling Mode) ===');

  // 1. Validate public key
  if (!AGENT_PUBLIC_KEY || AGENT_PUBLIC_KEY === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01') {
    console.error('Error: AGENT_PUBLIC_KEY is not configured in .env. Please provide a valid hex public key.');
    process.exit(1);
  }

  try {
    PublicKey.fromHex(AGENT_PUBLIC_KEY);
    console.log(`Agent Public Key: ${AGENT_PUBLIC_KEY}`);
  } catch (err: any) {
    console.error(`Error parsing AGENT_PUBLIC_KEY: ${err.message}`);
    process.exit(1);
  }

  // 2. Initialize MCP Client
  console.log('Connecting to Platform MCP Server...');
  let transport: any;
  const mcpServerUrl = process.env.MCP_SERVER_URL;

  if (mcpServerUrl) {
    console.log(`Using SSE Connection to: ${mcpServerUrl}`);
    transport = new SSEClientTransport(new URL(mcpServerUrl));
  } else {
    const mcpServerPath = path.resolve(__dirname, '../../app/server/dist/mcp-server.js');
    console.log(`Using local Stdio Connection to: ${mcpServerPath}`);
    if (!fs.existsSync(mcpServerPath)) {
      console.error(`Error: Compiled MCP server not found at: ${mcpServerPath}. Please run "npm run build" in app/server first.`);
      process.exit(1);
    }
    transport = new StdioClientTransport({
      command: 'node',
      args: [mcpServerPath],
      env: process.env as Record<string, string>,
    });
  }

  const mcpClient = new Client({
    name: 'agent-daemon-client',
    version: '1.0.0',
  });

  try {
    await mcpClient.connect(transport);
    console.log('✅ Connected to Platform MCP Server successfully.');
  } catch (err: any) {
    console.error(`Error connecting to MCP server: ${err.message}`);
    process.exit(1);
  }

  // 3. Start Polling Loop
  console.log(`Starting task polling loop every ${POLLING_INTERVAL_MS / 1000}s...`);
  setInterval(() => pollTasks(mcpClient), POLLING_INTERVAL_MS);
  
  // Initial check
  pollTasks(mcpClient);
}

main().catch((error) => {
  console.error('Fatal Daemon Error:', error);
  process.exit(1);
});
