import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { metricsRepository } from '../db/repositories/metrics-repository';
import { db } from '../db/client';

class Logger {
    private logFile: string;
    private logStream: fs.WriteStream;

    constructor() {
        const logDir = path.resolve(config.paths.logs);
        if (!fs.existsSync(logDir)) {
            try {
                fs.mkdirSync(logDir, { recursive: true });
            } catch (e) {
                console.error(`Failed to create log directory at ${logDir}:`, e);
            }
        }
        this.logFile = path.join(logDir, 'app.log');

        // Create a write stream in append mode
        this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });

        this.logStream.on('error', (err) => {
            console.error('Failed to write to log file stream:', err);
        });
    }

    private log(level: string, message: string, meta?: any) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...meta
        };

        const logString = JSON.stringify(logEntry);

        // 1. Console output (for Fly.io)
        if (level === 'error') {
            console.error(logString);
        } else {
            console.log(logString);
        }

        // 2. File output (Async via Stream)
        if (this.logStream.writable) {
            this.logStream.write(logString + '\n');
        }

        // 3. Database output (Legacy Shared DB for System Logs)
        if (['info', 'warn', 'error'].includes(level)) {
            try {
                const stmt = db.prepare(`
                    INSERT INTO system_logs (level, message, meta, timestamp)
                    VALUES (?, ?, ?, ?)
                `);
                stmt.run(level, message, meta ? JSON.stringify(meta) : null, timestamp);
            } catch (err) {
                // Silently fail to avoid infinite logging loop
            }
        }
    }

    public info(message: string, meta?: any) {
        this.log('info', message, meta);
    }

    public warn(message: string, meta?: any) {
        this.log('warn', message, meta);
    }

    public error(message: string, meta?: any) {
        this.log('error', message, meta);
    }

    public latency(callSid: string, event: 'STT_FINAL' | 'LLM_START' | 'LLM_FIRST_TOKEN' | 'TTS_FIRST_SENTENCE' | 'AUDIO_SENT', relativeMs: number, meta?: any) {
        this.log('latency', event, {
            callSid,
            relativeMs,
            latencyEvent: true,
            ...meta
        });
    }

    public economic(callSid: string, meta: { tokens_input?: number, tokens_output?: number, characters_sent?: number, call_duration_seconds?: number, clientId?: string }) {
        this.log('economic', 'UNIT_ECONOMICS', {
            callSid,
            economicEvent: true,
            ...meta
        });

        // Track metrics in database for billing
        if (meta.clientId) {
            try {
                if (meta.tokens_input) {
                    metricsRepository.track(meta.clientId, 'tokens_input', meta.tokens_input);
                }
                if (meta.tokens_output) {
                    metricsRepository.track(meta.clientId, 'tokens_output', meta.tokens_output);
                }
                if (meta.call_duration_seconds) {
                    metricsRepository.track(meta.clientId, 'call_duration', meta.call_duration_seconds);
                }
            } catch (err) {
                console.error('Failed to track metrics:', err);
            }
        }
    }

    /**
     * Track a metric directly (for call count, bookings, etc.)
     */
    public trackMetric(clientId: string, metricName: 'call_count' | 'booking_success' | 'booking_failed', value: number = 1) {
        try {
            metricsRepository.track(clientId, metricName, value);
        } catch (err) {
            console.error('Failed to track metric:', err);
        }
    }
}

export const logger = new Logger();
