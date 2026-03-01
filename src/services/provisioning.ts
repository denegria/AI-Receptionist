import twilio from 'twilio';
import { config } from '../config';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export class ProvisioningService {
  /**
   * Search for available local phone numbers
   */
  static async searchNumbers(areaCode?: string, limit: number = 5) {
    try {
      const params: any = { limit };
      if (areaCode) {
        params.areaCode = parseInt(areaCode);
      }
      const availableNumbers = await (twilioClient.availablePhoneNumbers('US').local as any).list(params);
      return (availableNumbers as any[]).map((n: any) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
      }));
    } catch (error) {
      logger.error('Error searching available numbers', { error, areaCode });
      throw error;
    }
  }

  /**
   * Buy a phone number and configure Twilio routing.
   * Preferred: voiceApplicationSid (TwiML App).
   * Fallback: direct voiceUrl webhook.
   */
  static async buyNumber(phoneNumber: string, clientId: string) {
    try {
      const createParams: Record<string, string> = { phoneNumber };

      if (config.twilio.twimlAppSid) {
        createParams.voiceApplicationSid = config.twilio.twimlAppSid;
      } else {
        const publicUrl = process.env.PUBLIC_URL;
        if (!publicUrl) {
          throw new Error('Missing required environment variable: PUBLIC_URL (required when TWILIO_TWIML_APP_SID is not set)');
        }
        createParams.voiceUrl = `${publicUrl.replace(/\/$/, '')}/voice`;
      }

      if (config.twilio.statusCallbackUrl) {
        createParams.statusCallback = config.twilio.statusCallbackUrl;
        createParams.statusCallbackMethod = 'POST';
      }

      const purchasedNumber = await twilioClient.incomingPhoneNumbers.create(createParams as any);

      logger.info('Successfully purchased phone number', { phoneNumber, clientId, sid: purchasedNumber.sid });
      return purchasedNumber;
    } catch (error: any) {
      // 21404: Trial account limit
      // 21421: Phone number is already in your account
      // 21452: Phone number already purchased
      if (error.code === 21404 || error.code === 21421 || error.code === 21452) {
         logger.warn('Phone number provisioning skipped (already owned or trial limit). Proceeding.', { code: error.code });
         return { phoneNumber, status: 'existing' };
      }
      logger.error('Error purchasing phone number', { error, phoneNumber, clientId });
      throw error;
    }
  }

  /**
   * Initialize a new client's database (The authorized way to bypass "Disk Bomb" fix)
   */
  static async initializeClientDatabase(clientId: string) {
    const dbDir = path.dirname(path.resolve(config.database.path));
    const clientDbPath = path.join(dbDir, `client-${clientId}.db`);

    if (fs.existsSync(clientDbPath)) {
      logger.warn(`Database already exists for client ${clientId}, skipping creation.`);
      return;
    }

    try {
      const clientDb = new Database(clientDbPath);
      clientDb.pragma('journal_mode = WAL');

      // Load schema
      let schemaPath = path.join(__dirname, '../db/schema.sql');
      if (!fs.existsSync(schemaPath)) {
          schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
      }
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      clientDb.exec(schema);

      clientDb.close();
      logger.info(`Successfully initialized database for client ${clientId}`);
    } catch (error) {
      logger.error(`Failed to initialize database for client ${clientId}`, { error });
      throw error;
    }
  }
}
