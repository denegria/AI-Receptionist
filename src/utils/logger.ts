import fs from 'fs';
import path from 'path';
import { config } from '../config';

export class Logger {
    private logStream?: fs.WriteStream;

    constructor() {
        if (config.nodeEnv === 'production') {
            const logPath = path.join(config.paths.logs, `${new Date().toISOString().split('T')[0]}.log`);
            this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
        }
    }

    private formatLog(level: string, message: string, meta?: any) {
        return JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(meta && { meta })
        });
    }

    info(message: string, meta?: any) {
        const log = this.formatLog('INFO', message, meta);
        console.log(log);
        this.logStream?.write(log + '\n');
    }

    error(message: string, meta?: any) {
        const log = this.formatLog('ERROR', message, meta);
        console.error(log);
        this.logStream?.write(log + '\n');
    }

    warn(message: string, meta?: any) {
        const log = this.formatLog('WARN', message, meta);
        console.warn(log);
        this.logStream?.write(log + '\n');
    }
}

export const logger = new Logger();
