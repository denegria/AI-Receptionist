import express from 'express';
import expressWs from 'express-ws';
import { config } from './config';
import { initDatabase, db, closeAllDatabases } from './db/client';
import { initSharedDatabase, closeSharedDatabase } from './db/shared-client';
import { MigrationManager } from './db/migration-manager';
import { errorHandler } from './api/middleware/error-handler';
import fs from 'fs';
import path from 'path';
import { logger } from './services/logging';

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

logger.info(`🚀 Starting AI Receptionist Server in ${config.nodeEnv} mode...`);

ensureDirectories();

const { app } = expressWs(express());

// Middleware
app.set('trust proxy', 1); // Required for Fly.io/Cloud load balancers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Rate Limiting
import rateLimit from 'express-rate-limit';
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Request logging in development
if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
        logger.info('HTTP Request', { method: req.method, path: req.path, ip: req.ip });
        next();
    });
}

// Routes
import { calendarAuthRouter } from './api/routes/calendar-auth';
import { twilioWebhookRouter } from './api/routes/twilio-webhook';
app.use(calendarAuthRouter);
app.use(twilioWebhookRouter);

// Health Check
app.get('/health', (req, res) => {
    try {
        db.prepare('SELECT 1').get();
        res.json({
            status: 'healthy',
            version: '1.0.0',
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

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'AI Receptionist',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});



// WebSocket endpoint for Media Streams
import { StreamHandler } from "./services/telephony/stream-handler";
import { onboardingWatcher } from './services/telephony/onboarding-watcher';

app.ws('/media-stream', (ws, req) => {
    const callSid = (req.query.callSid as string) || (req.headers['x-twilio-callsid'] as string);
    const clientId = (req.query.clientId as string) || (req.headers['x-twilio-clientid'] as string) || 'abc';
    logger.info(`📞 WebSocket requested`, { callSid, clientId });

    new StreamHandler(ws, clientId);

    ws.on('close', () => {
        logger.info(`📞 Client disconnected`, { callSid });
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error`, { callSid, error });
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, '0.0.0.0', () => {
    try {
        initDatabase();
        initSharedDatabase();
        MigrationManager.runMigrations();
        onboardingWatcher.start(); // Start the auto-onboarding service
        logger.info(`Server listening`, { port: config.port });
        console.log(`✓ WebSocket endpoint: ws://localhost:${config.port}/media-stream`);
        console.log(`✓ Health check: http://localhost:${config.port}/health\n`);
    } catch (error) {
        logger.error('Failed to start server', { error });
        process.exit(1);
    }
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    server.close(() => {
        console.log('✓ HTTP server closed');

        // Close all databases (legacy + client-specific + shared)
        try {
            onboardingWatcher.stop();
            closeAllDatabases();
            closeSharedDatabase();
        } catch (err) {
            console.error('✗ Error closing databases:', err);
        }

        console.log('👋 Shutdown complete');
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
