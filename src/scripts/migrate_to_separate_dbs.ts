import { db, getClientDatabase } from '../db/client';
import { loadClientConfig } from '../models/client-config';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Migration script to split shared database into client-specific databases
 * 
 * This script:
 * 1. Backs up the current shared database
 * 2. Extracts unique client IDs
 * 3. Creates a new database for each client
 * 4. Copies data filtered by client_id
 * 5. Verifies data integrity
 */

async function migrateToSeparateDatabases() {
    console.log('🔄 Starting database migration...\n');

    // Step 1: Backup existing database
    const backupPath = path.join(
        path.dirname(config.database.path),
        `receptionist_backup_${Date.now()}.db`
    );

    try {
        fs.copyFileSync(config.database.path, backupPath);
        console.log(`✓ Backed up database to: ${backupPath}\n`);
    } catch (err) {
        console.error('✗ Failed to create backup:', err);
        process.exit(1);
    }

    // Step 2: Get all unique client IDs
    const clients = db.prepare('SELECT DISTINCT client_id FROM call_logs').all() as { client_id: string }[];

    if (clients.length === 0) {
        console.log('⚠️  No clients found in database. Nothing to migrate.');
        return;
    }

    console.log(`Found ${clients.length} client(s) to migrate:`);
    clients.forEach(c => console.log(`  - ${c.client_id}`));
    console.log('');

    // Step 3 & 4: Migrate each client
    for (const { client_id } of clients) {
        console.log(`\n📦 Migrating client: ${client_id}`);

        try {
            const clientDb = getClientDatabase(client_id);

            // Migrate calendar credentials
            const creds = db.prepare(
                'SELECT * FROM calendar_credentials WHERE client_id = ?'
            ).get(client_id) as any;

            if (creds) {
                clientDb.prepare(`
                    INSERT OR REPLACE INTO calendar_credentials 
                    (client_id, provider, refresh_token, access_token, token_expires_at, calendar_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    creds.client_id,
                    creds.provider,
                    creds.refresh_token,
                    creds.access_token,
                    creds.token_expires_at,
                    creds.calendar_id,
                    creds.created_at,
                    creds.updated_at
                );
                console.log('  ✓ Migrated calendar credentials');
            }

            // Migrate appointments
            const appointments = db.prepare(
                'SELECT * FROM appointment_cache WHERE client_id = ?'
            ).all(client_id) as any[];

            for (const appt of appointments) {
                clientDb.prepare(`
                    INSERT OR REPLACE INTO appointment_cache
                    (client_id, calendar_event_id, provider, customer_name, customer_phone, customer_email, 
                     service_type, appointment_datetime, end_datetime, duration_minutes, status, synced_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    appt.client_id,
                    appt.calendar_event_id,
                    appt.provider,
                    appt.customer_name,
                    appt.customer_phone,
                    appt.customer_email,
                    appt.service_type,
                    appt.appointment_datetime,
                    appt.end_datetime,
                    appt.duration_minutes,
                    appt.status,
                    appt.synced_at,
                    appt.created_at
                );
            }
            console.log(`  ✓ Migrated ${appointments.length} appointment(s)`);

            // Migrate call logs
            const callLogs = db.prepare(
                'SELECT * FROM call_logs WHERE client_id = ?'
            ).all(client_id) as any[];

            for (const log of callLogs) {
                clientDb.prepare(`
                    INSERT OR REPLACE INTO call_logs
                    (client_id, call_sid, caller_phone, call_direction, call_status, call_duration,
                     intent_detected, conversation_summary, error_message, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    log.client_id,
                    log.call_sid,
                    log.caller_phone,
                    log.call_direction,
                    log.call_status,
                    log.call_duration,
                    log.intent_detected,
                    log.conversation_summary,
                    log.error_message,
                    log.created_at
                );

                // Migrate conversation turns for this call
                const turns = db.prepare(
                    'SELECT * FROM conversation_turns WHERE call_sid = ?'
                ).all(log.call_sid) as any[];

                for (const turn of turns) {
                    clientDb.prepare(`
                        INSERT OR REPLACE INTO conversation_turns
                        (call_sid, turn_number, role, content, timestamp)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(
                        turn.call_sid,
                        turn.turn_number,
                        turn.role,
                        turn.content,
                        turn.timestamp
                    );
                }
            }
            console.log(`  ✓ Migrated ${callLogs.length} call log(s) with conversation turns`);

            // Migrate voicemails
            const voicemails = db.prepare(
                'SELECT * FROM voicemails WHERE client_id = ?'
            ).all(client_id) as any[];

            for (const vm of voicemails) {
                clientDb.prepare(`
                    INSERT OR REPLACE INTO voicemails
                    (call_sid, client_id, recording_url, transcription_text, duration, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    vm.call_sid,
                    vm.client_id,
                    vm.recording_url,
                    vm.transcription_text,
                    vm.duration,
                    vm.created_at
                );
            }
            console.log(`  ✓ Migrated ${voicemails.length} voicemail(s)`);

        } catch (err) {
            console.error(`  ✗ Error migrating client ${client_id}:`, err);
            throw err;
        }
    }

    // Step 5: Verify data integrity
    console.log('\n\n🔍 Verifying data integrity...\n');

    for (const { client_id } of clients) {
        const clientDb = getClientDatabase(client_id);

        const originalCallCount = (db.prepare(
            'SELECT COUNT(*) as count FROM call_logs WHERE client_id = ?'
        ).get(client_id) as any).count;

        const migratedCallCount = (clientDb.prepare(
            'SELECT COUNT(*) as count FROM call_logs WHERE client_id = ?'
        ).get(client_id) as any).count;

        if (originalCallCount === migratedCallCount) {
            console.log(`✓ ${client_id}: ${migratedCallCount} call logs verified`);
        } else {
            console.error(`✗ ${client_id}: Mismatch! Original: ${originalCallCount}, Migrated: ${migratedCallCount}`);
            throw new Error('Data integrity check failed');
        }
    }

    console.log('\n\n✅ Migration completed successfully!');
    console.log(`\n📁 Client databases created in: ${path.dirname(config.database.path)}`);
    console.log(`💾 Backup saved at: ${backupPath}`);
    console.log('\n⚠️  IMPORTANT: The original shared database is still present.');
    console.log('   You can safely delete it after verifying the migration.');
}

// Run migration
migrateToSeparateDatabases()
    .then(() => {
        console.log('\n👋 Migration script finished.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    });
