import crypto from 'crypto';
import { config } from '../config';

export class CryptoUtils {
    private static algorithm = 'aes-256-cbc';

    private static getKey(): Buffer {
        const key = config.encryption?.key;
        if (!key) {
            throw new Error('ENCRYPTION_KEY is not defined in config');
        }
        // Key should be 32 bytes (64 hex chars)
        return Buffer.from(key, 'hex');
    }

    static encrypt(text: string): string {
        const key = this.getKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return `${iv.toString('hex')}:${encrypted}`;
    }

    static decrypt(encryptedText: string): string {
        const key = this.getKey();
        const parts = encryptedText.split(':');
        if (parts.length !== 2) {
            throw new Error('Invalid encrypted text format');
        }

        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];

        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
