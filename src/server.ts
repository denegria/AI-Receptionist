import express, { Request, Response, NextFunction } from 'express';
import expressWs from 'express-ws';
import WebSocket from 'ws';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config';
import { initDatabase, db, closeAllDatabases } from './db/client';
import { initSharedDatabase, closeSharedDatabase } from './db/shared-client';
import { MigrationManager } from './db/migration-manager';
import { errorHandler } from './api/middleware/error-handler';
import fs from 'fs';
import path from 'path';
import { logger } from './services/logging';
import { redisCoordinator } from './services/coordination/redis-coordinator';
import { startCalendarSyncLoop, stopCalendarSyncLoop } from './services/scheduling/calendar-sync-service';

function errorDetails(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return { value: String(error) };
}

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
    app.use((req: Request, res: Response, next: NextFunction) => {
        logger.info('HTTP Request', { method: req.method, path: req.path, ip: req.ip });
        next();
    });
}

// Routes
import { calendarAuthRouter } from './api/routes/calendar-auth';
import { twilioWebhookRouter } from './api/routes/twilio-webhook';
import { onboardingRouter } from './api/routes/onboarding';
import { dashboardRouter } from './api/routes/dashboard';
import { adminDashboardRouter } from './api/routes/admin-dashboard';
import { requireAuth } from './api/middleware/auth';

app.use(calendarAuthRouter);
app.use('/api', requireAuth, calendarAuthRouter);
app.use(twilioWebhookRouter);
app.use('/api/onboarding', requireAuth, onboardingRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/admin', requireAuth, adminDashboardRouter);

// Public Health Check (no auth, no secrets)
app.get('/healthz', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ok: true,
        service: 'ai-receptionist-backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

// Health Check (legacy)
app.get('/health', (req: Request, res: Response) => {
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

app.get('/', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        service: 'AI Receptionist',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});



// Media stream transports
import { StreamHandler } from "./services/telephony/stream-handler";
import { onboardingWatcher } from './services/telephony/onboarding-watcher';

if (config.transport.mode === 'legacy-ws' || config.transport.mode === 'dual') {
    app.ws('/media-stream', (ws: WebSocket, req: Request) => {
        const callSid = (req.query.callSid as string) || (req.headers['x-twilio-callsid'] as string);
        const clientId = (req.query.clientId as string) || (req.headers['x-twilio-clientid'] as string) || 'abc';
        logger.info(`📞 WebSocket requested`, { callSid, clientId });

        new StreamHandler(ws as any, clientId);

        ws.on('close', () => logger.info(`📞 Client disconnected`, { callSid }));
        ws.on('error', (error) => logger.error(`WebSocket error`, { callSid, error }));
    });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, '0.0.0.0', async () => {
    try {
        initDatabase();
        initSharedDatabase();
        MigrationManager.runMigrations();
        await redisCoordinator.init();
        onboardingWatcher.start(); // Start the auto-onboarding service
        startCalendarSyncLoop();
        logger.info(`Server listening`, { port: config.port, transportMode: config.transport.mode });
        if (config.transport.mode === 'legacy-ws' || config.transport.mode === 'dual') {
            console.log(`✓ WebSocket endpoint: ws://localhost:${config.port}/media-stream`);
        }
        console.log(`✓ Socket.IO endpoint: ws://localhost:${config.port}${config.transport.socketPath}`);
        console.log(`✓ Health check: http://localhost:${config.port}/health\n`);
    } catch (error) {
        logger.error('Failed to start server', { error: errorDetails(error) });
        process.exit(1);
    }
});

const io = new SocketIOServer(server, {
    path: config.transport.socketPath,
    cors: { origin: '*' },
});

if (config.transport.mode === 'socketio' || config.transport.mode === 'dual') {
    io.on('connection', (socket) => {
        const clientId = (socket.handshake.query.clientId as string) || 'abc';
        logger.info('📞 Socket.IO stream connected', { socketId: socket.id, clientId });

        const socketAdapter = {
            readyState: 1,
            on(event: 'message' | 'close' | 'error', cb: (...args: any[]) => void) {
                if (event === 'message') {
                    socket.on('twilio-message', (payload: any) => cb(typeof payload === 'string' ? payload : JSON.stringify(payload)));
                } else if (event === 'close') {
                    socket.on('disconnect', cb);
                } else {
                    socket.on('error', cb);
                }
            },
            send(data: string) {
                socket.emit('twilio-message', data);
            },
            close() {
                socket.disconnect(true);
            }
        };

        new StreamHandler(socketAdapter as any, clientId);
    });
}

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: errorDetails(reason) });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: errorDetails(error) });
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    server.close(() => {
        console.log('✓ HTTP server closed');

        // Close all databases (legacy + client-specific + shared)
        try {
            onboardingWatcher.stop();
            stopCalendarSyncLoop();
            closeAllDatabases();
            closeSharedDatabase();
            redisCoordinator.close().catch(() => undefined);
        } catch (err) {
            console.error('✗ Error closing databases:', err);
        }

        io.close();
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
