# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies (needed for modules like better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# We run tsc first, and then manually copy the database assets using Linux commands
# This bypasses the Windows-specific 'xcopy' and 'copy' in your package.json
RUN npx tsc && \
    mkdir -p dist/db/migrations && \
    cp -r src/db/migrations/. dist/db/migrations/ && \
    cp src/db/schema.sql dist/db/schema.sql

# Production stage
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# Create directory for SQLite persistence
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

# Expose the internal port
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]