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

export function loadClientConfig(clientId: string): ClientConfig {
    const configPath = path.resolve(config.paths.clientConfigs, `client-${clientId}.json`); // e.g. client-abc.json for 'abc'

    // Try exact match first, then formatted
    let finalPath = configPath;
    if (!fs.existsSync(finalPath)) {
        // If clientId is 'hvac-co-123', try looking for 'client-hvac-co-123.json' ?? 
        // Actually standardizing on: config/clients/{filename}.json
        // Let's assume we map phone number -> filename or just load by filename directly.
        // For now, simple implementation:
        throw new Error(`Client config not found for ID: ${clientId} at ${configPath}`);
    }

    const raw = fs.readFileSync(finalPath, 'utf-8');
    return JSON.parse(raw) as ClientConfig;
}

export function getClientByPhoneNumber(phoneNumber: string): ClientConfig | null {
    // Iterate over all configs in the dir to find matching phone. efficient? no. MVP? yes.
    const files = fs.readdirSync(config.paths.clientConfigs);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const raw = fs.readFileSync(path.join(config.paths.clientConfigs, file), 'utf-8');
            const data = JSON.parse(raw) as ClientConfig;
            if (data.phoneNumber === phoneNumber) return data;
        }
    }
    return null;
}
