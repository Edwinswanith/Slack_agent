import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  const dbPath = process.env.DATABASE_PATH;

  if (!dbPath) {
    throw new Error(
      "DATABASE_PATH environment variable is not set. " +
      "Set it to a SQLite file path (e.g., ./data/grantproof.db)"
    );
  }

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Open or create the database
  const instance = new Database(dbPath);

  // Enable foreign keys
  instance.pragma("foreign_keys = ON");

  // Read and execute the schema (idempotent)
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  instance.exec(schema);

  runMigrations(instance);

  db = instance;
  return db;
}

/**
 * Phase 3: adds masked_claim_text/masked_quote_text columns to an existing
 * evidence table. SQLite has no "ADD COLUMN IF NOT EXISTS", so check
 * PRAGMA table_info first — this keeps existing dev/demo data intact instead
 * of requiring a fresh DB file.
 */
function runMigrations(instance: Database.Database): void {
  const columns = instance.prepare("PRAGMA table_info(evidence)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  if (!columnNames.has("masked_claim_text")) {
    instance.exec("ALTER TABLE evidence ADD COLUMN masked_claim_text TEXT");
  }
  if (!columnNames.has("masked_quote_text")) {
    instance.exec("ALTER TABLE evidence ADD COLUMN masked_quote_text TEXT");
  }
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export default Database;
