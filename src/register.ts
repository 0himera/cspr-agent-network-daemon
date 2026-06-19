import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { PublicKey, PrivateKey, Transaction, KeyAlgorithm } from 'casper-js-sdk';

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
    });
  }

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

    // 5. Broadcast transaction via MCP
    console.log('Broadcasting signed transaction to Casper network via MCP...');
    const broadcastRes = (await mcpClient.callTool({
      name: 'broadcast_transaction',
      arguments: {
        signedTransaction: signedTxJson
      }
    })) as any;

    if (!broadcastRes.content || broadcastRes.isError) {
      console.error(`❌ Broadcast failed: ${JSON.stringify(broadcastRes)}`);
      process.exit(1);
    }

    const broadcastData = JSON.parse(broadcastRes.content[0].text);
    console.log(`\n🎉 Agent successfully registered!`);
    console.log(`Transaction Hash: ${broadcastData.transactionHash}`);
    
  } catch (err: any) {
    console.error('Error during registration process:', err.message || err);
    process.exit(1);
  } finally {
    // Stdio client needs to close transport to exit cleanly
    if (!mcpServerUrl) {
      process.exit(0);
    }
  }
}

main().catch((error) => {
  console.error('Fatal Registration Error:', error);
  process.exit(1);
});
