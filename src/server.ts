import express from 'express';
import expressWs from 'express-ws';
import { config } from './config';
import { initDatabase, db } from './db/client';
import { errorHandler } from './api/middleware/error-handler';
import fs from 'fs';
import path from 'path';

// Ensure required directories exist
function ensureDirectories() {
    const dirs = [
        path.dirname(config.database.path),
        config.paths.clientConfigs,
        config.paths.logs,
    ];

    if (config.database.backupPath) {
        dirs.push(config.database.backupPath);
    }

    if (config.paths.recordings) {
        dirs.push(config.paths.recordings);
    }

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✓ Created directory: ${dir}`);
        }
    });
}

console.log(`🚀 Starting AI Receptionist Server in ${config.nodeEnv} mode...`);

ensureDirectories();
initDatabase();

const { app } = expressWs(express());

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Request logging in development
if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.path}`);
        next();
    });
}

// Routes
import { calendarAuthRouter } from './api/routes/calendar-auth';
import { twilioWebhookRouter } from './api/routes/twilio-webhook';
app.use(calendarAuthRouter);
app.use(twilioWebhookRouter);

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'AI Receptionist',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Health check with database
app.get('/health', (req, res) => {
    try {
        // Test database connection
        db.prepare('SELECT 1').get();

        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// WebSocket endpoint for Media Streams
import { StreamHandler } from "./services/telephony/stream-handler";
app.ws('/media-stream', (ws, req) => {
    const callSid = req.query.callSid as string;
    console.log(`📞 Client connected to media stream (Call SID: ${callSid})`);

    new StreamHandler(ws);

    ws.on('close', () => {
        console.log(`📞 Client disconnected (Call SID: ${callSid})`);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error (Call SID: ${callSid}):`, error);
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, () => {
    console.log(`\n✓ Server listening on port ${config.port}`);
    console.log(`✓ WebSocket endpoint: ws://localhost:${config.port}/media-stream`);
    console.log(`✓ Health check: http://localhost:${config.port}/health\n`);
});

// Graceful shutdown
function gracefulShutdown(signal: string) {

    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
