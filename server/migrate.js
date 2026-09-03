import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env. Migration aborted.');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });

async function run() {
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        course TEXT NOT NULL DEFAULT '',
        subjects JSONB NOT NULL DEFAULT '[]',
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]'");

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        role TEXT NOT NULL,
        text TEXT,
        time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Migration completed');
  } catch (e) {
    console.error('Migration failed', e);
  } finally {
    await client.end();
    process.exit(0);
  }
}

run();
