import fs from 'fs';
import path from 'path';
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
        credentials: {
            type: 'oauth2';
            refreshToken: string;
        };
        syncEnabled: boolean;
        createMeetLinks: boolean;
    };

    routing: {
        afterHoursAction: 'ai_receptionist' | 'voicemail' | 'forward';
        fallbackNumber: string;
        voicemailEnabled: boolean;
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

// Caching & Loading
let clientCache: Map<string, ClientConfig> | null = null;

function loadAllClients(): Map<string, ClientConfig> {
    const cache = new Map<string, ClientConfig>();

    if (!fs.existsSync(config.paths.clientConfigs)) {
        console.warn(`Client config directory not found: ${config.paths.clientConfigs}`);
        return cache;
    }

    const files = fs.readdirSync(config.paths.clientConfigs);

    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const raw = fs.readFileSync(
                    path.join(config.paths.clientConfigs, file),
                    'utf-8'
                );
                const data = validateClientConfig(JSON.parse(raw));
                // Cache by ID
                cache.set(data.clientId, data);
                // Also cache by Phone Number for fast lookup
                cache.set(data.phoneNumber, data);
            } catch (error) {
                console.error(`Error loading client config ${file}:`, error);
            }
        }
    }

    return cache;
}

export function loadClientConfig(clientIdOrPhone: string): ClientConfig {
    if (!clientCache) {
        clientCache = loadAllClients();
    }

    const client = clientCache.get(clientIdOrPhone);

    if (!client) {
        // Logic could be improved here to handle dynamic IDs vs Phone Numbers more explicitly
        // But for now, the cache contains both keys.
        throw new Error(`Client config not found for: ${clientIdOrPhone}`);
    }

    return client;
}

export function getClientByPhoneNumber(phoneNumber: string): ClientConfig | null {
    if (!clientCache) {
        clientCache = loadAllClients();
    }
    return clientCache.get(phoneNumber) || null;
}

export function clearClientCache(): void {
    clientCache = null;
}
