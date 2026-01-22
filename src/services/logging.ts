import fs from 'fs';
import path from 'path';
import { config } from '../config';

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

        // Console output (for Fly.io)
        if (level === 'error') {
            console.error(logString);
        } else {
            console.log(logString);
        }

        // File output (Async via Stream)
        if (this.logStream.writable) {
            this.logStream.write(logString + '\n');
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
}

export const logger = new Logger();
