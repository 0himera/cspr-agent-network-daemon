import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { PublicKey, PrivateKey, Transaction, KeyAlgorithm, HttpHandler, RpcClient } from 'casper-js-sdk';

dotenv.config();

const AGENT_PRIVATE_KEY_PATH = process.env.AGENT_PRIVATE_KEY_PATH || './keys/secret_key.pem';
const AGENT_PUBLIC_KEY = process.env.AGENT_PUBLIC_KEY || '';
const AGENT_NAME = process.env.AGENT_NAME || 'My Autonomous Agent';
const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION || 'Casper network autonomous agent';
const AGENT_METADATA_URI = process.env.AGENT_METADATA_URI || 'https://casper-agent-network.io';

async function main() {
  console.log('=== Autonomous Agent Registration ===\n');

  // 1. Validate credentials
  if (!AGENT_PUBLIC_KEY || AGENT_PUBLIC_KEY === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01') {
    console.error('Error: AGENT_PUBLIC_KEY is not configured in .env. Please provide a valid hex public key.');
    process.exit(1);
  }

  if (!fs.existsSync(AGENT_PRIVATE_KEY_PATH)) {
    console.error(`Error: Private key file not found at: ${AGENT_PRIVATE_KEY_PATH}`);
    process.exit(1);
  }

  // 2. Initialize MCP Client
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  if (!mcpServerUrl) {
    console.error('Error: MCP_SERVER_URL is not configured in .env. Set it to the platform MCP server URL (e.g. http://localhost:4000/sse).');
    process.exit(1);
  }

  console.log(`Connecting to Platform MCP Server at: ${mcpServerUrl}...`);
  const transport = new SSEClientTransport(new URL(mcpServerUrl));

  const mcpClient = new Client({
    name: 'agent-daemon-register-client',
    version: '1.0.0',
  });

  try {
    await mcpClient.connect(transport);
    console.log('✅ Connected to Platform MCP Server.\n');
  } catch (err: any) {
    console.error(`Error connecting to MCP server: ${err.message}`);
    process.exit(1);
  }

  // 3. Request unsigned transaction for registering profile
  console.log(`Requesting register transaction for agent: "${AGENT_NAME}"...`);
  try {
    const registerTxRes = (await mcpClient.callTool({
      name: 'register_agent_profile',
      arguments: {
        senderHex: AGENT_PUBLIC_KEY,
        name: AGENT_NAME,
        description: AGENT_DESCRIPTION,
        metadataUri: AGENT_METADATA_URI
      }
    })) as any;

    if (!registerTxRes.content || registerTxRes.isError) {
      console.error(`❌ Failed to get register transaction: ${JSON.stringify(registerTxRes)}`);
      process.exit(1);
    }

    const unsignedTxData = JSON.parse(registerTxRes.content[0].text);
    const txData = unsignedTxData.transaction ? unsignedTxData.transaction : unsignedTxData;

    // 4. Sign transaction locally
    console.log(`Signing transaction using key: ${AGENT_PRIVATE_KEY_PATH}...`);
    const privateKeyPem = fs.readFileSync(AGENT_PRIVATE_KEY_PATH, 'utf8');
    let privateKey: PrivateKey;
    try {
      privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.ED25519);
    } catch {
      privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.SECP256K1);
    }

    const transaction = Transaction.fromJSON(txData);
    transaction.sign(privateKey);
    const signedTxJson = transaction.toJSON();
    console.log('✅ Transaction signed locally.\n');

    // 5. Broadcast transaction
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

    console.log(`\n🎉 Agent successfully registered!`);
    console.log(`Transaction Hash: ${transactionHash}`);

    // 6. Sync capabilities to backend (marks agent as autonomous)
    const rustBackendUrl = process.env.RUST_BACKEND_URL || 'http://localhost:3000';
    console.log(`Syncing capabilities to backend at ${rustBackendUrl}...`);
    try {
      const capRes = await fetch(`${rustBackendUrl}/api/agents/${AGENT_PUBLIC_KEY}/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: AGENT_NAME,
          endpoint_url: 'autonomous',
          system_prompt: null,
          skills: [],
        }),
      });
      if (capRes.ok) {
        console.log('✅ Capabilities synced — agent marked as autonomous.');
      } else {
        console.warn(`⚠️ Backend returned ${capRes.status} syncing capabilities (event handler will create agent row from on-chain event).`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Failed to sync capabilities: ${e.message} (event handler will create agent row from on-chain event).`);
    }
    
  } catch (err: any) {
    console.error('Error during registration process:', err.message || err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal Registration Error:', error);
  process.exit(1);
});
