import express from "express";
import expressWs from "express-ws";
import { config } from "./config";
import { initDatabase } from "./db/client";

console.log(`Config loaded successfully in ${config.nodeEnv} mode.`);
initDatabase();

const { app } = expressWs(express());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
