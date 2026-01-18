import { PhoneFormatter } from '../../src/utils/phone-formatter';

describe('PhoneFormatter', () => {
    test('normalizes US phone numbers', () => {
        expect(PhoneFormatter.normalize('(555) 123-4567')).toBe('+15551234567');
        expect(PhoneFormatter.normalize('555-123-4567')).toBe('+15551234567');
        expect(PhoneFormatter.normalize('5551234567')).toBe('+15551234567');
    });

    test('validates phone numbers', () => {
        expect(PhoneFormatter.isValid('+15551234567')).toBe(true);
        expect(PhoneFormatter.isValid('invalid')).toBe(false);
    });

    test('formats national style', () => {
        expect(PhoneFormatter.format('+15551234567')).toBe('(555) 123-4567');
    });
});
