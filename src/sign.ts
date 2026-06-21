import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrivateKey, Transaction, KeyAlgorithm, HttpHandler, RpcClient } from 'casper-js-sdk';

// Load environment variables
dotenv.config();
// Fallback to load from .env if not found in parent dirs
if (!process.env.AGENT_PUBLIC_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const AGENT_PRIVATE_KEY_PATH = process.env.AGENT_PRIVATE_KEY_PATH || './keys/secret_key.pem';
const CASPER_NODE_URL = process.env.CASPER_NODE_URL || 'https://node.testnet.casper.network/rpc';

async function main() {
  const txFilePath = process.argv[2];

  if (!txFilePath) {
    console.error('Usage: npm run sign <path-to-transaction.json>');
    process.exit(1);
  }

  const resolvedTxPath = path.resolve(process.cwd(), txFilePath);

  if (!fs.existsSync(resolvedTxPath)) {
    console.error(`Error: Transaction file not found at ${resolvedTxPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(AGENT_PRIVATE_KEY_PATH)) {
    console.error(`Error: Private key file not found at ${AGENT_PRIVATE_KEY_PATH}`);
    process.exit(1);
  }

  console.log(`Reading unsigned transaction from ${txFilePath}...`);
  let unsignedTxRaw;
  try {
    const fileContent = fs.readFileSync(resolvedTxPath, 'utf8');
    unsignedTxRaw = JSON.parse(fileContent);
  } catch (err: any) {
    console.error(`Error parsing JSON transaction file: ${err.message}`);
    process.exit(1);
  }

  // Extract inner transaction object if wrapped
  const txData = unsignedTxRaw.transaction ? unsignedTxRaw.transaction : unsignedTxRaw;

  console.log(`Loading private key from ${AGENT_PRIVATE_KEY_PATH}...`);
  const privateKeyPem = fs.readFileSync(AGENT_PRIVATE_KEY_PATH, 'utf8');
  let privateKey: PrivateKey;
  try {
    privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.ED25519);
  } catch {
    privateKey = PrivateKey.fromPem(privateKeyPem, KeyAlgorithm.SECP256K1);
  }

  console.log(`Signing transaction locally...`);
  let transaction: Transaction;
  try {
    transaction = Transaction.fromJSON(txData);
    transaction.sign(privateKey);
  } catch (err: any) {
    console.error(`Error signing transaction (invalid format): ${err.message}`);
    process.exit(1);
  }
  
  const signedTxJson = transaction.toJSON();
  console.log('✅ Transaction signed successfully.');

  console.log(`Broadcasting transaction to Casper node RPC at: ${CASPER_NODE_URL}...`);
  let transactionHash: string;

  try {
    const rpcHandler = new HttpHandler(CASPER_NODE_URL);
    const rpcClient = new RpcClient(rpcHandler);
    const result = await rpcClient.putTransaction(transaction);
    transactionHash = result.transactionHash.toHex ? result.transactionHash.toHex() : (result.rawJSON.transaction_hash.Version1 || result.transactionHash);
    console.log('✅ Broadcasted successfully via RpcClient.');
  } catch (err: any) {
    console.warn(`⚠️ RpcClient broadcast failed: ${err.message || err}. Trying direct HTTP JSON-RPC POST fallback...`);
    
    // Fallback: direct HTTP POST to JSON-RPC endpoint
    const response = await fetch(CASPER_NODE_URL, {
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
      console.error(`❌ Direct RPC call failed: ${JSON.stringify(resJson.error)}`);
      process.exit(1);
    }
    transactionHash = resJson.result.transaction_hash.Version1;
    console.log('✅ Broadcasted successfully via direct HTTP POST.');
  }

  console.log(`\n🎉 Process completed!`);
  console.log(`Transaction Hash: ${transactionHash}`);
}

main().catch((error) => {
  console.error('Fatal Error:', error);
  process.exit(1);
});
