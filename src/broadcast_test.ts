import * as fs from 'fs';
import * as path from 'path';
import { Transaction, RpcClient, HttpHandler } from 'casper-js-sdk';

const SIGNED_TX_PATH = path.resolve(__dirname, '../signed_tx.json');
const NODE_URL = 'https://node.testnet.casper.network/rpc';

async function main() {
  console.log('Loading signed transaction from:', SIGNED_TX_PATH);
  if (!fs.existsSync(SIGNED_TX_PATH)) {
    console.error('Signed transaction file not found!');
    process.exit(1);
  }

  const signedTxJson = JSON.parse(fs.readFileSync(SIGNED_TX_PATH, 'utf8'));

  // Method 1: Try direct HTTP JSON-RPC call
  console.log('\n--- Method 1: Direct JSON-RPC fetch ---');
  try {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'account_put_transaction',
      params: {
        transaction: signedTxJson
      }
    };

    console.log('Sending request to', NODE_URL);
    const response = await fetch(NODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const resJson = await response.json() as any;
    console.log('Direct RPC status:', response.status);
    console.log('Direct RPC response:', JSON.stringify(resJson, null, 2));
  } catch (err: any) {
    console.error('Direct RPC failed:', err.message || err);
  }

  // Method 2: Try SDK RpcClient
  console.log('\n--- Method 2: SDK RpcClient ---');
  try {
    const transaction = Transaction.fromJSON(signedTxJson);
    console.log('Transaction parsed successfully via SDK.');
    
    console.log('Initializing HttpHandler and RpcClient...');
    const rpcHandler = new HttpHandler(NODE_URL);
    const rpcClient = new RpcClient(rpcHandler);
    
    console.log('Calling putTransaction...');
    const result = await rpcClient.putTransaction(transaction);
    console.log('SDK putTransaction success:', result);
  } catch (err: any) {
    console.error('SDK putTransaction failed:', err.message || err);
  }

  // Method 3: Query Transaction Status
  console.log('\n--- Method 3: Query Transaction Status ---');
  try {
    const txHash = signedTxJson.hash;
    console.log('Querying transaction status for hash:', txHash);
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'info_get_transaction',
      params: {
        transaction_hash: {
          Version1: txHash
        }
      }
    };
    const response = await fetch(NODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const resJson = await response.json() as any;
    console.log('Transaction Status Response:', JSON.stringify(resJson, null, 2));
  } catch (err: any) {
    console.error('Failed to query transaction status:', err.message || err);
  }
}

main().catch(console.error);
