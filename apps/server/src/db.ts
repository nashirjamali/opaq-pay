import pg from 'pg';

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Ordered, append-only. Never edit a released migration; add a new one. */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      create table announcements (
        id bigserial primary key,
        signature text not null,
        ix_index integer not null,
        slot bigint not null,
        block_time bigint,
        ephemeral_pubkey bytea not null check (length(ephemeral_pubkey) = 32),
        stealth_address text not null,
        view_tag smallint not null check (view_tag between 0 and 255),
        inserted_at timestamptz not null default now(),
        unique (signature, ix_index)
      );
      create table indexer_cursors (
        name text primary key,
        signature text not null,
        slot bigint not null,
        updated_at timestamptz not null default now()
      );
      create table relay_log (
        id bigserial primary key,
        signature text not null,
        client text not null,
        lamport_cost bigint not null,
        created_at timestamptz not null default now()
      );
      create index relay_log_created_at on relay_log (created_at);
    `,
  },
];

export async function migrate(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    // One migrator at a time across instances.
    await client.query('select pg_advisory_lock(424242)');
    await client.query('create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())');
    const { rows } = await client.query<{ version: number }>('select version from schema_migrations');
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query('insert into schema_migrations (version) values ($1)', [migration.version]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}
