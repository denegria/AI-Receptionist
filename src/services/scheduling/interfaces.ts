export interface TimeSlot {
    start: string; // ISO 8601
    end: string;   // ISO 8601
    available: boolean;
}

export interface CalendarEvent {
    id: string;
    summary: string;
    start: string;
    end: string;
    description?: string;
    location?: string;
    attendees?: string[];
    meetLink?: string;
}

export interface ICalendarService {
    /**
     * Generates or retrieves the Auth URL for the user to connect their calendar
     */
    getAuthUrl(clientId: string): string;

    /**
     * Exchanges auth code for tokens and saves them
     */
    handleCallback(clientId: string, code: string): Promise<void>;

    /**
     * Lists available times (inverse of busy) or raw busy slots
     */
    getBusyTimes(clientId: string, start: string, end: string): Promise<TimeSlot[]>;

    /**
     * Creates a new event
     */
    createEvent(clientId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
}
