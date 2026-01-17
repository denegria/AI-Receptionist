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
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('Database initialized successfully.');
}
