import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

export async function runMigration(filename) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const sql = await readFile(
    new URL('../supabase/migrations/' + filename, import.meta.url),
    'utf8'
  );
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration completed: ' + filename);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
