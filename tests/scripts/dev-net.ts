/**
 * Local network for working on the web app without devnet SOL or USDC.
 *
 *   pnpm --filter @opaq/integration-tests dev-net     (run `anchor build` first)
 *
 * Starts an offline surfnet with both programs deployed and the vault initialised (USDC
 * stand-in, wrapper mint, 0.5% fee), then serves one fixed port:
 *   POST /          JSON-RPC, proxied to the surfnet with CORS headers
 *   POST /faucet    { "address": "...", "sol": 2, "usdc": 100 }  funds a wallet
 *   GET  /info      { rpcUrl, usdcMint, wrappedMint, programs }
 *
 * Point the web app at it with NEXT_PUBLIC_RPC_URL=http://localhost:8899. The program IDs are
 * the same as devnet's, so nothing else changes. State is in memory and gone on exit.
 */
import { createServer } from 'node:http';
import { isAddress } from '@solana/kit';
import { DEVNET_PROGRAMS, fetchVaultSettings, getInitVaultInstruction, vault } from '@opaq/sdk';
import { startTestNet } from '../helpers.js';

const PORT = Number(process.env.DEV_NET_PORT ?? 8899);
const FEE_BPS = 50;

const net = await startTestNet();
const usdc = await net.createUsdcMint();
const treasury = await net.createAta(net.admin.address, usdc);
const [config] = await vault.findConfigPda();
const wrappedMint = await net.createWrappedMint(config);
await net.send(
  [await getInitVaultInstruction({ admin: net.admin, underlyingMint: usdc, wrappedMint, treasury, feeBps: FEE_BPS })],
  net.admin,
);
const settings = await fetchVaultSettings(net.rpc);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': '*',
};

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown, type = 'application/json') => {
    res.writeHead(status, { ...cors, 'content-type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  try {
    if (req.method === 'OPTIONS') return send(204, '');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/info') {
      return send(200, {
        rpcUrl: `http://localhost:${PORT}`,
        usdcMint: settings.underlyingMint,
        wrappedMint: settings.wrappedMint,
        programs: DEVNET_PROGRAMS,
      });
    }
    if (req.method === 'POST' && path === '/faucet') {
      const body = JSON.parse(await readBody(req)) as { address?: string; sol?: number; usdc?: number };
      if (!body.address || !isAddress(body.address)) return send(400, { error: 'address required' });
      const sol = Math.min(body.sol ?? 2, 10);
      const amount = Math.min(body.usdc ?? 100, 1000);
      if (sol > 0) net.surfnet.fundSol(body.address, Math.round(sol * 1e9));
      if (amount > 0) await net.mintUsdc(usdc, body.address, BigInt(Math.round(amount * 1e6)));
      return send(200, { ok: true, sol, usdc: amount });
    }
    if (req.method === 'POST' && path === '/') {
      const upstream = await fetch(net.surfnet.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await readBody(req),
      });
      return send(upstream.status, await upstream.text());
    }
    send(404, { error: 'not found' });
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Opaq dev net on http://localhost:${PORT}`);
  console.log(`  USDC stand-in  ${settings.underlyingMint}`);
  console.log(`  wrapper mint   ${settings.wrappedMint}`);
  console.log(`  fund a wallet  curl -X POST localhost:${PORT}/faucet -d '{"address":"<address>"}'`);
});

const stop = () => {
  server.close();
  net.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
