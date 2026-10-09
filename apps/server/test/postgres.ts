/** A throwaway Postgres for tests: DATABASE_URL if set, else a temp cluster via initdb/pg_ctl. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export async function startPostgres(): Promise<{ url: string; stop: () => void }> {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, stop: () => {} };
  const dir = mkdtempSync(join(tmpdir(), 'opaq-pg-'));
  const port = await freePort();
  // Postgres refuses to start without a valid locale in the environment (macOS shells often lack one).
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  execFileSync('initdb', ['-D', join(dir, 'data'), '-U', 'opaq', '--auth=trust', '-E', 'UTF8', '--no-locale'], { stdio: 'ignore', env });
  // TCP only: the temp dir path is too long for a Unix socket on macOS.
  execFileSync(
    'pg_ctl',
    ['-D', join(dir, 'data'), '-l', join(dir, 'log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=`, '-w', 'start'],
    { stdio: 'ignore', env },
  );
  return {
    url: `postgres://opaq@127.0.0.1:${port}/postgres`,
    stop: () => {
      try {
        execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore', env });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
