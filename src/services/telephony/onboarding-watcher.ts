import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { clearClientCache } from '../../models/client-config';
import { logger } from '../logging';

export class OnboardingWatcher {
    private isRunning = false;
    private interval: NodeJS.Timeout | null = null;
    private readonly POLL_INTERVAL_MS = 10000; // 10 seconds

    constructor() {
        this.ensureOnboardingDir();
    }

    private ensureOnboardingDir() {
        const dir = config.paths.onboarding;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info(`✓ Created onboarding directory: ${dir}`);
        }
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info('🚀 Onboarding Watcher started');

        // Use polling for compatibility with all filesystems (especially Fly.io volumes)
        this.interval = setInterval(() => this.scan(), this.POLL_INTERVAL_MS);
        // Initial scan
        this.scan();
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info('🛑 Onboarding Watcher stopped');
    }

    private scan() {
        try {
            const dir = config.paths.onboarding;
            const files = fs.readdirSync(dir);

            for (const file of files) {
                // Safeguards:
                // 1. Only process .json files
                // 2. Ignore files that are already .processed
                // 3. Ignore files with "template" in the name
                if (file.endsWith('.json') && !file.includes('template')) {
                    this.processFile(path.join(dir, file));
                }
            }
        } catch (error) {
            logger.error('Error scanning onboarding directory', { error });
        }
    }

    private processFile(filePath: string) {
        const fileName = path.basename(filePath);
        logger.info(`📦 Ingesting new client config: ${fileName}`);

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const clientConfig = JSON.parse(raw);

            // 1. Basic Validation (id, name, phone)
            if (!clientConfig.clientId || !clientConfig.businessName || !clientConfig.phoneNumber) {
                throw new Error('Missing required fields (clientId, businessName, phoneNumber)');
            }

            // 2. Upsert into Database Registry
            const existing = clientRegistryRepository.findById(clientConfig.clientId);
            if (existing) {
                logger.info(`  ℹ️ Updating existing client: ${clientConfig.clientId}`);
                clientRegistryRepository.updateConfig(clientConfig.clientId, clientConfig);
            } else {
                logger.info(`  ✓ Registering new client: ${clientConfig.clientId}`);
                clientRegistryRepository.register(clientConfig);
            }

            // 3. Clear Cache
            clearClientCache();

            // 4. Mark as processed
            const processedPath = `${filePath}.processed`;
            fs.renameSync(filePath, processedPath);
            logger.info(`  ✅ Success! Renamed to ${path.basename(processedPath)}`);

        } catch (error) {
            logger.error(`  ✗ Failed to process ${fileName}`, {
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            // Rename to .error to prevent infinite retry loops
            try {
                fs.renameSync(filePath, `${filePath}.error`);
            } catch (renameErr) {
                // Silently fail if we can't even rename it
            }
        }
    }
}

export const onboardingWatcher = new OnboardingWatcher();
