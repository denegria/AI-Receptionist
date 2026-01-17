import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

interface Config {
    // Server
    port: number;
    nodeEnv: string;

    // Twilio
    twilio: {
        accountSid: string;
        authToken: string;
        phoneNumber: string;
    };

    // Deepgram
    deepgram: {
        apiKey: string;
    };

    // AI (support both Claude and OpenAI for fallback)
    ai: {
        provider: 'claude' | 'openai';
        anthropicApiKey?: string;
        openaiApiKey?: string;
    };

    // Google Calendar Integration
    google: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };

    // Microsoft Graph (Outlook)
    microsoft: {
        clientId: string;
        clientSecret: string;
        tenantId: string;
    };

    // Database
    database: {
        path: string;
    };

    // Paths
    paths: {
        clientConfigs: string;
    };

    // Admin
    admin: {
        apiKey: string;
    };
}

function getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

export const config: Config = {
    port: parseInt(getEnvVar('PORT', '3000')),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),

    twilio: {
        accountSid: getEnvVar('TWILIO_ACCOUNT_SID'),
        authToken: getEnvVar('TWILIO_AUTH_TOKEN'),
        phoneNumber: getEnvVar('TWILIO_PHONE_NUMBER'),
    },

    deepgram: {
        apiKey: getEnvVar('DEEPGRAM_API_KEY'),
    },

    ai: {
        provider: (getEnvVar('AI_PROVIDER', 'claude') as 'claude' | 'openai'),
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
    },

    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback",
    },

    microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID || "",
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
        tenantId: process.env.MICROSOFT_TENANT_ID || "common",
    },

    database: {
        path: getEnvVar('DB_PATH', './receptionist.db'),
    },

    paths: {
        clientConfigs: getEnvVar('CLIENT_CONFIGS_PATH', './config/clients'),
    },

    admin: {
        apiKey: getEnvVar('ADMIN_API_KEY'),
    },
};

// Validate Configuration
function validateConfig(cfg: Config): void {
    // Validate AI provider has corresponding API key
    if (cfg.ai.provider === 'claude' && !cfg.ai.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY required when AI_PROVIDER=claude');
    }
    if (cfg.ai.provider === 'openai' && !cfg.ai.openaiApiKey) {
        throw new Error('OPENAI_API_KEY required when AI_PROVIDER=openai');
    }

    // Validate port is valid
    if (cfg.port < 1 || cfg.port > 65535) {
        throw new Error(`Invalid PORT: ${cfg.port}`);
    }

    if (cfg.nodeEnv === 'development') {
        console.log('\n📋 Configuration Status:');
        console.log(`  - AI Provider: ${cfg.ai.provider}`);
        console.log(`  - Database: ${cfg.database.path}`);
        console.log(`  - Client Configs: ${cfg.paths.clientConfigs}`);

        if (!cfg.google.clientId) {
            console.warn('  ⚠️  Google Calendar not configured');
        }
        if (!cfg.microsoft.clientId) {
            console.warn('  ⚠️  Outlook Calendar not configured');
        }
        console.log('');
    }
}

validateConfig(config);
