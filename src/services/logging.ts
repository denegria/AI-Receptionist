import fs from 'fs';
import path from 'path';
import { config } from '../config';

class Logger {
    private logFile: string;

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

        // File output (for persistence)
        try {
            fs.appendFileSync(this.logFile, logString + '\n');
        } catch (e) {
            // Don't crash if logging fails, but warn locally
            console.error('Failed to write to log file:', e);
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
}

export const logger = new Logger();
