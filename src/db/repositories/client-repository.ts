import { db } from '../client';

export class ClientRepository {
    getSettings(clientId: string): any | null {
        const stmt = db.prepare('SELECT settings_json FROM client_settings WHERE client_id = ?');
        const row = stmt.get(clientId) as { settings_json: string } | undefined;
        return row ? JSON.parse(row.settings_json) : null;
    }

    updateSettings(clientId: string, settings: any): void {
        const settingsJson = JSON.stringify(settings);
        const stmt = db.prepare(`
            INSERT INTO client_settings (client_id, settings_json)
            VALUES (?, ?)
            ON CONFLICT(client_id) DO UPDATE SET
                settings_json = excluded.settings_json,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(clientId, settingsJson);
    }
}

export const clientRepository = new ClientRepository();
