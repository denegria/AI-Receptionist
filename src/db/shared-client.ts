import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const sharedDbPath = path.join(
    path.dirname(path.resolve(config.database.path)),
    'shared.db'
);

// Shared database for client registry (NO sensitive data)
export const sharedDb = new Database(sharedDbPath);
sharedDb.pragma('journal_mode = WAL');

/**
 * Initialize shared database with schema
 */
export function initSharedDatabase(): void {
    try {
        let schemaPath = path.join(__dirname, 'shared-schema.sql');

        // Fallback for compiled dist directory
        if (!fs.existsSync(schemaPath)) {
            schemaPath = path.join(process.cwd(), 'src', 'db', 'shared-schema.sql');
        }

        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Shared schema file not found at: ${schemaPath}`);
        }

        const schema = fs.readFileSync(schemaPath, 'utf-8');
        sharedDb.exec(schema);
        console.log('✓ Shared database initialized');

        // Verify tables were created
        const tables = sharedDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).all();
        console.log(`✓ Shared tables: ${tables.map((t: any) => t.name).join(', ')}`);

    } catch (error) {
        console.error('✗ Shared database initialization failed:', error);
        throw error;
    }
}

/**
 * Close shared database connection
 */
export function closeSharedDatabase(): void {
    try {
        sharedDb.close();
        console.log('✓ Closed shared database');
    } catch (err) {
        console.error('✗ Error closing shared database:', err);
    }
}
