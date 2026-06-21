import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { PublicKey, PrivateKey, Transaction, KeyAlgorithm, HttpHandler, RpcClient } from 'casper-js-sdk';

dotenv.config();

const AGENT_PRIVATE_KEY_PATH = process.env.AGENT_PRIVATE_KEY_PATH || './keys/secret_key.pem';
const AGENT_PUBLIC_KEY = process.env.AGENT_PUBLIC_KEY || '';

async function signAndBroadcast(mcpClient: Client, toolName: string, args: Record<string, any>): Promise<string> {
  const res = (await mcpClient.callTool({ name: toolName, arguments: args })) as any;
  if (!res.content || res.isError) throw new Error(`MCP ${toolName} failed: ${JSON.stringify(res)}`);
  const unsignedTxData = JSON.parse(res.content[0].text);
  const txData = unsignedTxData.transaction ? unsignedTxData.transaction : unsignedTxData;

  const privateKeyPem = fs.readFileSync(AGENT_PRIVATE_KEY_PATH, 'utf8');
  let privateKey: PrivateKey;
  try {
    privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.ED25519);
  } catch {
    privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.SECP256K1);
  }

  const transaction = Transaction.fromJSON(txData);
  transaction.sign(privateKey);

  const nodeUrl = process.env.CASPER_NODE_URL || 'https://node.testnet.casper.network/rpc';
  const rpcHandler = new HttpHandler(nodeUrl);
  const rpcClient = new RpcClient(rpcHandler);
  const result = await rpcClient.putTransaction(transaction);
  const txHash = result.transactionHash.toHex ? result.transactionHash.toHex() : (result.rawJSON.transaction_hash.Version1 || result.transactionHash);
  return txHash;
}

async function main() {
  console.log('=== Create & Assign Task ===\n');

  const taskId = `task_daemon_${Date.now().toString(36)}`;
  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h from now

  const mcpServerUrl = process.env.MCP_SERVER_URL;
  if (!mcpServerUrl) {
    console.error('Error: MCP_SERVER_URL is not configured in .env. Set it to the platform MCP server URL (e.g. http://localhost:4000/sse).');
    process.exit(1);
  }

  const transport = new SSEClientTransport(new URL(mcpServerUrl));
  const mcpClient = new Client({ name: 'agent-daemon-task-creator', version: '1.0.0' });
  await mcpClient.connect(transport);
  console.log(`✅ Connected to MCP Server at ${mcpServerUrl}.\n`);

  const backendUrl = process.env.RUST_BACKEND_URL || 'http://localhost:3000';

  try {
    // 1. Create task on-chain
    console.log(`Creating task: ${taskId}...`);
    console.log(`  Budget: 1 CSPR (1000000000 motes)`);
    console.log(`  Deadline: ${new Date(deadline * 1000).toISOString()}`);
    const createTxHash = await signAndBroadcast(mcpClient, 'create_task', {
      senderHex: AGENT_PUBLIC_KEY,
      taskId,
      budgetMotes: '1000000000',
      metadataUri: 'https://casper-agent-network.io/tasks/defi-analysis',
      deadline,
    });
    console.log(`✅ Task created! TX: ${createTxHash}\n`);

    // Sync task to DB via backend
    console.log('Syncing task to DB...');
    const createRes = await fetch(`${backendUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: taskId,
        creator_public_key: AGENT_PUBLIC_KEY,
        budget_motes: 1000000000,
        transaction_hash: createTxHash,
        domain: 'defi_analysis',
        prompt: '',
        deadline,
      }),
    });
    if (createRes.ok) console.log('✅ Task synced to DB');
    else console.log('⚠️ Task sync failed:', await createRes.text());

    // 2. Assign task to self on-chain
    console.log(`\nAssigning task ${taskId} to agent ${AGENT_PUBLIC_KEY.substring(0, 20)}...`);
    const assignTxHash = await signAndBroadcast(mcpClient, 'assign_task', {
      senderHex: AGENT_PUBLIC_KEY,
      taskId,
      agentHex: AGENT_PUBLIC_KEY,
    });
    console.log(`✅ Task assigned! TX: ${assignTxHash}\n`);

    console.log(`\n🎉 Task ${taskId} created and assigned successfully!`);
    console.log(`The daemon polling loop will pick it up within 5 seconds.`);
  } finally {
    process.exit(0);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
