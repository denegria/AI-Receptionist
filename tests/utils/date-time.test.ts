import { DateTimeUtils } from '../../src/utils/date-time';
import { ClientConfig } from '../../src/models/client-config';

describe('DateTimeUtils', () => {
    const mockConfig: Partial<ClientConfig> = {
        timezone: 'America/New_York',
        businessHours: {
            monday: { enabled: true, start: '09:00', end: '17:00' },
            tuesday: { enabled: true, start: '09:00', end: '17:00' },
            wednesday: { enabled: true, start: '09:00', end: '17:00' },
            thursday: { enabled: true, start: '09:00', end: '17:00' },
            friday: { enabled: true, start: '09:00', end: '17:00' },
            saturday: { enabled: false, start: '00:00', end: '00:00' },
            sunday: { enabled: false, start: '00:00', end: '00:00' }
        },
        holidays: ['2026-01-01']
    };

    test('identifies business hours correctly', () => {
        // Monday at 10 AM ET
        const date = new Date('2026-01-19T15:00:00Z'); // 10 AM ET
        expect(DateTimeUtils.isBusinessHours(mockConfig as ClientConfig, date)).toBe(true);

        // Monday at 8 PM ET
        const eveningDate = new Date('2026-01-20T01:00:00Z'); // 8 PM ET
        expect(DateTimeUtils.isBusinessHours(mockConfig as ClientConfig, eveningDate)).toBe(false);

        // Sunday
        const sunday = new Date('2026-01-18T15:00:00Z');
        expect(DateTimeUtils.isBusinessHours(mockConfig as ClientConfig, sunday)).toBe(false);
    });

    test('identifies holidays', () => {
        const holiday = new Date('2026-01-01T12:00:00Z');
        expect(DateTimeUtils.isHoliday(mockConfig as ClientConfig, holiday)).toBe(true);

        const normalDay = new Date('2026-01-02T12:00:00Z');
        expect(DateTimeUtils.isHoliday(mockConfig as ClientConfig, normalDay)).toBe(false);
    });
});
