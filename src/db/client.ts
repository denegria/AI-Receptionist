import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const dbDir = path.dirname(path.resolve(config.database.path));

// Ensure DB directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Legacy shared database (for backward compatibility during migration)
const legacyDbPath = path.resolve(config.database.path);
export const db = new Database(legacyDbPath);
db.pragma('journal_mode = WAL');

// Client-specific database pool
const clientDatabases = new Map<string, Database.Database>();

/**
 * Get an existing client-specific database connection
 */
export function getClientDatabase(clientId: string): Database.Database {
    if (!clientDatabases.has(clientId)) {
        const clientDbPath = path.join(dbDir, `client-${clientId}.db`);

        // Disk Bomb Fix: Do NOT create database if it doesn't exist
        if (!fs.existsSync(clientDbPath)) {
            console.error(`SECURITY ALERT: Attempted to access non-existent database for client: ${clientId}`);
            throw new Error(`Unauthorized access: Database for client ${clientId} does not exist.`);
        }

        const clientDb = new Database(clientDbPath);
        clientDb.pragma('journal_mode = WAL');

        clientDatabases.set(clientId, clientDb);
    }

    return clientDatabases.get(clientId)!;
}

/**
 * Close all client database connections (for graceful shutdown)
 */
export function closeAllDatabases(): void {
    for (const [clientId, database] of clientDatabases) {
        try {
            database.close();
            console.log(`✓ Closed database for client: ${clientId}`);
        } catch (err) {
            console.error(`✗ Error closing database for ${clientId}:`, err);
        }
    }
    clientDatabases.clear();

    try {
        db.close();
        console.log('✓ Closed legacy shared database');
    } catch (err) {
        console.error('✗ Error closing legacy database:', err);
    }
}

/**
 * Get schema content from file
 */
function getSchemaContent(): string {
    let schemaPath = path.join(__dirname, 'schema.sql');

    // Fallback for compiled dist directory
    if (!fs.existsSync(schemaPath)) {
        schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
    }

    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    return fs.readFileSync(schemaPath, 'utf-8');
}

/**
 * Initialize legacy shared database (backward compatibility)
 */
export function initDatabase() {
    try {
        const schema = getSchemaContent();
        db.exec(schema);
        console.log('✓ Database initialized successfully.');

        // Verify tables were created
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).all();
        console.log(`✓ Created tables: ${tables.map((t: any) => t.name).join(', ')}`);

    } catch (error) {
        console.error('✗ Database initialization failed:', error);
        throw error;
    }
}
