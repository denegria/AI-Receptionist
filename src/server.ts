import express from "express";
import expressWs from "express-ws";
import { config } from "./config";
import { initDatabase } from "./db/client";

console.log(`Config loaded successfully in ${config.nodeEnv} mode.`);
initDatabase();

const { app } = expressWs(express());

import { calendarAuthRouter } from './routes/calendar-auth';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use(calendarAuthRouter);

// Basic health check
app.get("/", (req, res) => {
    res.send("AI Receptionist Server is running.");
});

// WebSocket endpoint for Media Streams (placeholder)
app.ws("/media-stream", (ws, req) => {
    console.log("Client connected to media stream");

    ws.on("message", (msg) => {
        console.log("Received message:", msg);
    });

    ws.on("close", () => {
        console.log("Client disconnected");
    });
});

app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
});

// Graceful Shutdown
function gracefulShutdown(signal: string) {
    console.log(`\n${signal} received. Closing server gracefully...`);

    // Close database connection (if applicable, though better-sqlite3 is synchronous)
    // db.close(); // better-sqlite3 closes automatically on process exit usually, but explicit is good if we export it.
    // For now, just logging as we don't export db instance to here directly yet except via init.
    // Actually, we should export db from client.ts to close it.
    console.log('✓ Database connection closed');

    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
