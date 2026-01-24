import { sharedDb } from '../shared-client';
import { ClientConfig } from '../../models/client-config';

export interface ClientRegistryEntry {
    id: string;
    business_name: string;
    phone_number: string;
    timezone: string;
    status: 'active' | 'suspended' | 'trial';
    config_json: string;
    created_at?: string;
    updated_at?: string;
}

export class ClientRegistryRepository {
    /**
     * Register a new client in the registry
     */
    register(client: ClientConfig): void {
        const stmt = sharedDb.prepare(`
            INSERT INTO clients (id, business_name, phone_number, timezone, status, config_json)
            VALUES (?, ?, ?, ?, 'active', ?)
        `);

        stmt.run(
            client.clientId,
            client.businessName,
            client.phoneNumber,
            client.timezone,
            JSON.stringify(client)
        );
    }

    /**
     * Find client by ID
     */
    findById(id: string): ClientRegistryEntry | null {
        const stmt = sharedDb.prepare('SELECT * FROM clients WHERE id = ?');
        return stmt.get(id) as ClientRegistryEntry || null;
    }

    /**
     * Find client by phone number
     */
    findByPhone(phoneNumber: string): ClientRegistryEntry | null {
        const stmt = sharedDb.prepare('SELECT * FROM clients WHERE phone_number = ?');
        return stmt.get(phoneNumber) as ClientRegistryEntry || null;
    }

    /**
     * Update client status (active, suspended, trial)
     */
    updateStatus(id: string, status: 'active' | 'suspended' | 'trial'): void {
        const stmt = sharedDb.prepare(`
            UPDATE clients 
            SET status = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `);
        stmt.run(status, id);
    }

    /**
     * Update client configuration
     */
    updateConfig(id: string, config: ClientConfig): void {
        const stmt = sharedDb.prepare(`
            UPDATE clients 
            SET business_name = ?,
                phone_number = ?,
                timezone = ?,
                config_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        stmt.run(
            config.businessName,
            config.phoneNumber,
            config.timezone,
            JSON.stringify(config),
            id
        );
    }

    /**
     * Get all active clients
     */
    listActive(): ClientRegistryEntry[] {
        const stmt = sharedDb.prepare(`
            SELECT * FROM clients 
            WHERE status = 'active' 
            ORDER BY business_name ASC
        `);
        return stmt.all() as ClientRegistryEntry[];
    }

    /**
     * Get all clients (any status)
     */
    listAll(): ClientRegistryEntry[] {
        const stmt = sharedDb.prepare('SELECT * FROM clients ORDER BY business_name ASC');
        return stmt.all() as ClientRegistryEntry[];
    }

    /**
     * Parse config JSON from registry entry
     */
    parseConfig(entry: ClientRegistryEntry): ClientConfig {
        return JSON.parse(entry.config_json) as ClientConfig;
    }
}

export const clientRegistryRepository = new ClientRegistryRepository();
