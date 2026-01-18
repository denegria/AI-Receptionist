import { ClientConfig } from '../models/client-config';

export class DateTimeUtils {
    static isBusinessHours(
        config: ClientConfig,
        dateTime: Date = new Date()
    ): boolean {
        const day = dateTime.toLocaleDateString('en-US', {
            weekday: 'long',
            timeZone: config.timezone
        }).toLowerCase();

        const hours = config.businessHours[day];
        if (!hours || !hours.enabled) {
            return false;
        }

        const timeString = dateTime.toLocaleTimeString('en-US', {
            hour12: false,
            timeZone: config.timezone,
            hour: '2-digit',
            minute: '2-digit'
        });

        return timeString >= hours.start && timeString <= hours.end;
    }

    static isHoliday(config: ClientConfig, date: Date = new Date()): boolean {
        const dateString = date.toISOString().split('T')[0];
        return config.holidays.includes(dateString);
    }

    static shouldUseAI(config: ClientConfig): boolean {
        const now = new Date();
        return !this.isBusinessHours(config, now) || this.isHoliday(config, now);
    }

    static parseTimeSlot(timeStr: string, timezone: string): Date {
        // Basic implementation for parsing time in specific timezone
        // For production, library like 'luxon' is usually better
        return new Date(timeStr);
    }

    static formatDuration(minutes: number): string {
        if (minutes < 60) {
            return `${minutes} minutes`;
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
    }
}
