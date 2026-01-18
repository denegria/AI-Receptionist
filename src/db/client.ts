import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const dbPath = path.resolve(config.database.path);
const dbDir = path.dirname(dbPath);

// Ensure DB directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

export function initDatabase() {
    try {
        let schemaPath = path.join(__dirname, 'schema.sql');

        // Fallback for compiled dist directory
        if (!fs.existsSync(schemaPath)) {
            schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
        }

        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found at: ${schemaPath}`);
        }

        const schema = fs.readFileSync(schemaPath, 'utf-8');
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
