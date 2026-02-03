import { sharedDb, initSharedDatabase } from '../db/shared-client';
import { clientRegistryRepository } from '../db/repositories/client-registry-repository';
import { loadClientConfig } from '../models/client-config';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Sync existing client JSON files to the shared database registry
 * 
 * This is a one-time migration script to populate the clients table
 * from existing JSON configuration files.
 */

async function syncClientsToRegistry() {
    console.log('🔄 Syncing client configs to registry...\n');

    // Initialize shared database
    initSharedDatabase();

    const clientsDir = path.resolve(config.paths.clientConfigs);

    if (!fs.existsSync(clientsDir)) {
        console.error(`✗ Client configs directory not found: ${clientsDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(clientsDir).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
        console.log('⚠️  No client config files found.');
        return;
    }

    console.log(`Found ${files.length} client config(s):\n`);

    let synced = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(clientsDir, file);

        try {
            const rawConfig = fs.readFileSync(filePath, 'utf-8');
            const clientConfig = JSON.parse(rawConfig);

            // Validate it has required fields
            if (!clientConfig.clientId || !clientConfig.businessName || !clientConfig.phoneNumber) {
                console.log(`⚠️  Skipping ${file}: Missing required fields`);
                skipped++;
                continue;
            }

            // Check if already exists
            const existing = clientRegistryRepository.findById(clientConfig.clientId);

            if (existing) {
                console.log(`  ℹ️  ${clientConfig.clientId} (${clientConfig.businessName}) - Already in registry, updating...`);
                clientRegistryRepository.updateConfig(clientConfig.clientId, clientConfig);
            } else {
                console.log(`  ✓ ${clientConfig.clientId} (${clientConfig.businessName}) - Added to registry`);
                clientRegistryRepository.register(clientConfig);
            }

            synced++;

        } catch (error) {
            console.error(`  ✗ Error processing ${file}:`, error);
            skipped++;
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  ✓ Synced: ${synced}`);
    console.log(`  ⚠️  Skipped: ${skipped}`);

    // Verify
    const allClients = clientRegistryRepository.listAll();
    console.log(`\n📋 Total clients in registry: ${allClients.length}`);

    for (const client of allClients) {
        console.log(`  - ${client.id}: ${client.business_name} (${client.status})`);
    }

    console.log('\n✅ Sync completed successfully!');
}

// Run sync
syncClientsToRegistry()
    .then(() => {
        console.log('\n👋 Sync script finished.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Sync failed:', err);
        process.exit(1);
    });
