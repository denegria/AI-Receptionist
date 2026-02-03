import { config } from '../config';

export interface BusinessHours {
    start: string;
    end: string;
    enabled: boolean;
}

export interface AppointmentType {
    name: string;
    duration: number;
    bufferBefore: number;
    bufferAfter: number;
}

export interface ClientConfig {
    clientId: string;
    businessName: string;
    phoneNumber: string;
    timezone: string;

    businessHours: {
        [key: string]: BusinessHours;
    };

    holidays: string[];

    appointmentTypes: AppointmentType[];

    calendar: {
        provider: 'google' | 'outlook';
        calendarId: string;
        syncEnabled: boolean;
        createMeetLinks: boolean;
    };

    routing: {
        afterHoursAction: 'ai_receptionist' | 'voicemail' | 'forward';
        fallbackNumber: string;
        voicemailEnabled: boolean;
    };

    notifications?: {
        sms?: string;
        email?: string;
    };

    aiSettings: {
        greeting: string;
        maxRetries: number;
        requireServiceType: boolean;
    };
}

// Validation Helper
function validateClientConfig(config: any): ClientConfig {
    if (!config.clientId) throw new Error('clientId is required');
    if (!config.businessName) throw new Error('businessName is required');
    if (!config.phoneNumber) throw new Error('phoneNumber is required');

    // Validate timezone
    try {
        Intl.DateTimeFormat(undefined, { timeZone: config.timezone });
    } catch (e) {
        throw new Error(`Invalid timezone: ${config.timezone}`);
    }

    // Validate Calendar Provider
    if (!['google', 'outlook'].includes(config.calendar.provider)) {
        throw new Error('Calendar provider must be "google" or "outlook"');
    }

    return config as ClientConfig;
}

// Caching & Loading System
import { sharedDb } from '../db/shared-client';

let clientCache: Map<string, ClientConfig> = new Map();

/**
 * Loads a client configuration from the Shared Database registry.
 * Supports lookup by clientId or phone_number.
 */
export function loadClientConfig(clientIdOrPhone: string): ClientConfig {
    // 1. Check Cache
    if (clientCache.has(clientIdOrPhone)) {
        return clientCache.get(clientIdOrPhone)!;
    }

    // 2. Query Database
    const stmt = sharedDb.prepare(`
        SELECT config_json FROM clients 
        WHERE id = ? OR phone_number = ?
    `);

    const entry = stmt.get(clientIdOrPhone, clientIdOrPhone) as { config_json: string } | undefined;

    if (!entry) {
        throw new Error(`Client not found in registry: ${clientIdOrPhone}`);
    }

    try {
        const fullConfig = validateClientConfig(JSON.parse(entry.config_json));

        // 3. Cache results
        clientCache.set(fullConfig.clientId, fullConfig);
        clientCache.set(fullConfig.phoneNumber, fullConfig);

        return fullConfig;
    } catch (error) {
        console.error(`Failed to parse config for ${clientIdOrPhone}:`, error);
        throw new Error(`Corrupt configuration for client ${clientIdOrPhone}`);
    }
}

export function getClientByPhoneNumber(phoneNumber: string): ClientConfig | null {
    try {
        return loadClientConfig(phoneNumber);
    } catch (e) {
        return null;
    }
}

export function clearClientCache(): void {
    clientCache.clear();
}
