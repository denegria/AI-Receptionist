export class PhoneFormatter {
    static normalize(phone: string): string {
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '');

        // Add country code if missing (assuming US/Canada)
        if (digits.length === 10) {
            return `+1${digits}`;
        }

        if (digits.length === 11 && digits.startsWith('1')) {
            return `+${digits}`;
        }

        return digits ? `+${digits}` : '';
    }

    static format(phone: string, style: 'national' | 'international' = 'national'): string {
        const normalized = this.normalize(phone);
        const digits = normalized.replace(/^\+1/, '');

        if (style === 'national' && digits.length === 10) {
            return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        }

        return normalized;
    }

    static isValid(phone: string): boolean {
        const normalized = this.normalize(phone);
        // Basic validation: check if it's a valid E.164 format for US/Canada
        return /^\+1\d{10}$/.test(normalized);
    }
}
