import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}

interface Config {
    port: number;
    nodeEnv: string;
    logLevel: 'debug' | 'info' | 'warn' | 'error';

    twilio: {
        accountSid: string;
        authToken: string;
        phoneNumber: string;
        statusCallbackUrl?: string;
    };

    deepgram: {
        apiKey: string;
        model: string;
        language: string;
    };

    voice: {
        asrConfidenceThreshold: number;
        silenceTimeoutMs: number;
        maxDurationMs: number;
    };

    ai: {
        provider: 'claude' | 'openai';
        anthropicApiKey?: string;
        openaiApiKey?: string;
        model: string;
        temperature: number;
        maxTokens: number;
    };

    google: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };

    microsoft: {
        clientId: string;
        clientSecret: string;
        tenantId: string;
    };

    database: {
        path: string;
        backupEnabled: boolean;
        backupPath?: string;
    };

    paths: {
        clientConfigs: string;
        logs: string;
        recordings?: string;
    };

    admin: {
        apiKey: string;
    };

    encryption: {
        key: string;
    };

    features: {
        callRecording: boolean;
        webSearch: boolean;
        smsNotifications: boolean;
        enableStreamingLLM: boolean;
        enableStreamingTTS: boolean;
    };
}

function getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function generateEncryptionKey(): string {
    if (process.env.ENCRYPTION_KEY) {
        return process.env.ENCRYPTION_KEY;
    }

    console.warn('⚠️  ENCRYPTION_KEY not set. Generating temporary key (not for production!)');
    return crypto.randomBytes(32).toString('hex');
}

export const config: Config = {
    port: parseInt(getEnvVar('PORT', '3000')),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    logLevel: (getEnvVar('LOG_LEVEL', 'info') as any),

    twilio: {
        accountSid: getEnvVar('TWILIO_ACCOUNT_SID'),
        authToken: getEnvVar('TWILIO_AUTH_TOKEN'),
        phoneNumber: getEnvVar('TWILIO_PHONE_NUMBER'),
        statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
    },

    deepgram: {
        apiKey: getEnvVar('DEEPGRAM_API_KEY'),
        model: getEnvVar('DEEPGRAM_MODEL', 'nova-2'),
        language: getEnvVar('DEEPGRAM_LANGUAGE', 'en-US'),
    },

    voice: {
        asrConfidenceThreshold: parseFloat(getEnvVar('ASR_CONFIDENCE_THRESHOLD', '0.6')),
        silenceTimeoutMs: parseInt(getEnvVar('SILENCE_TIMEOUT_MS', '1000')),
        maxDurationMs: parseInt(getEnvVar('MAX_CALL_DURATION_MS', '600000')), // 10 minutes
    },

    ai: {
        provider: (getEnvVar('AI_PROVIDER', 'claude') as 'claude' | 'openai'),
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        model: getEnvVar('AI_MODEL', 'claude-3-haiku-20240307'),
        temperature: parseFloat(getEnvVar('AI_TEMPERATURE', '0.7')),
        maxTokens: parseInt(getEnvVar('AI_MAX_TOKENS', '1024')),
    },

    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    },

    microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
        tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    },

    database: {
        path: process.env.DB_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/receptionist.db' : './receptionist.db'),
        backupEnabled: getEnvVar('DB_BACKUP_ENABLED', 'false') === 'true',
        backupPath: process.env.DB_BACKUP_PATH || (process.env.NODE_ENV === 'production' ? '/app/data/backups' : './backups'),
    },

    paths: {
        clientConfigs: getEnvVar('CLIENT_CONFIGS_PATH', process.env.NODE_ENV === 'production' ? '/app/config/clients' : './config/clients'),
        logs: getEnvVar('LOGS_PATH', process.env.NODE_ENV === 'production' ? '/app/data/logs' : './logs'),
        recordings: process.env.RECORDINGS_PATH,
    },

    admin: {
        apiKey: getEnvVar('ADMIN_API_KEY'),
    },

    encryption: {
        key: generateEncryptionKey(),
    },

    features: {
        callRecording: getEnvVar('FEATURE_CALL_RECORDING', 'false') === 'true',
        webSearch: getEnvVar('FEATURE_WEB_SEARCH', 'false') === 'true',
        smsNotifications: getEnvVar('FEATURE_SMS_NOTIFICATIONS', 'false') === 'true',
        enableStreamingLLM: getEnvVar('ENABLE_STREAMING_LLM', 'false') === 'true',
        enableStreamingTTS: getEnvVar('ENABLE_STREAMING_TTS', 'false') === 'true',
    },
};

// Validation
export function validateEnvironment(): void {
    const errors: string[] = [];

    // Check required variables
    if (!process.env.TWILIO_ACCOUNT_SID) errors.push('TWILIO_ACCOUNT_SID');
    if (!process.env.TWILIO_AUTH_TOKEN) errors.push('TWILIO_AUTH_TOKEN');
    if (!process.env.DEEPGRAM_API_KEY) errors.push('DEEPGRAM_API_KEY');

    if (config.ai.provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
        errors.push('ANTHROPIC_API_KEY (required for Claude)');
    }

    if (config.nodeEnv === 'production' && config.encryption.key.length !== 64) {
        errors.push('ENCRYPTION_KEY must be 64 hex characters in production');
    }

    if (errors.length > 0) {
        console.error('\n❌ Missing required environment variables:');
        errors.forEach(e => console.error(`   - ${e}`));
        console.error('\n💡 Copy .env.example to .env and fill in your values\n');
        process.exit(1);
    }

    console.log('✓ Environment validation passed');
}

validateEnvironment();

// Development logging
if (config.nodeEnv === 'development') {
    console.log('\n📋 Configuration Loaded:');
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log(`  Port: ${config.port}`);
    console.log(`  AI Provider: ${config.ai.provider} (${config.ai.model})`);
    console.log(`  Database: ${config.database.path}`);
    console.log(`  Client Configs: ${config.paths.clientConfigs}`);

    if (!config.google.clientId) {
        console.warn('  ⚠️  Google Calendar not configured');
    }
    if (!config.microsoft.clientId) {
        console.warn('  ⚠️  Outlook Calendar not configured');
    }
    console.log('');
}

