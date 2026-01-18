import { db } from './client';
import fs from 'fs';
import path from 'path';

export class MigrationManager {
    static init() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    static runMigrations() {
        this.init();
        const migrationsDir = path.join(__dirname, 'migrations');

        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
            return;
        }

        const files = fs.readdirSync(migrationsDir).sort();
        const applied = db.prepare('SELECT name FROM _migrations').all().map((m: any) => m.name);

        for (const file of files) {
            if (file.endsWith('.sql') && !applied.includes(file)) {
                console.log(`🚀 Applying migration: ${file}`);
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

                try {
                    db.transaction(() => {
                        db.exec(sql);
                        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
                    })();
                    console.log(`✓ Migration successful: ${file}`);
                } catch (error) {
                    console.error(`✗ Migration failed: ${file}`, error);
                    throw error;
                }
            }
        }
    }
}
