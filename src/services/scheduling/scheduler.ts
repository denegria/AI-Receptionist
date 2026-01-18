import { GoogleCalendarService } from './google-calendar';
import { OutlookCalendarService } from './outlook-calendar';
import { AppointmentRepository, appointmentRepository } from '../../db/repositories/appointment-repository';
import { loadClientConfig, ClientConfig } from '../../models/client-config';
import { TimeSlot, CalendarEvent } from './interfaces';

export interface AppointmentRequest {
    customerName: string;
    customerPhone: string;
    startTime: string; // ISO
    endTime: string;   // ISO
    description?: string;
}

export class SchedulerService {
    private google = new GoogleCalendarService();
    private outlook = new OutlookCalendarService();
    private cache = appointmentRepository;

    private getProvider(config: ClientConfig) {
        if (config.calendar.provider === 'google') return this.google;
        if (config.calendar.provider === 'outlook') return this.outlook;
        throw new Error(`Unknown calendar provider: ${config.calendar.provider}`);
    }

    async checkAvailability(clientId: string, start: string, end: string): Promise<TimeSlot[]> {
        const config = loadClientConfig(clientId);
        const service = this.getProvider(config);

        try {
            const busySlots = await service.getBusyTimes(clientId, start, end);
            // Here we would subtract busy slots from business hours to return "Free" slots
            // For MVP, we pass back the raw busy data or we invert it?
            // Let's just return busy slots for now, and the LLM/Caller logic will find gaps.
            // OR better: Implement a simple "find gaps" logic here later.
            return busySlots;
        } catch (err) {
            console.error("Error fetching availability:", err);
            // Fallback to cache?
            return [];
        }
    }

    async bookAppointment(clientId: string, request: AppointmentRequest): Promise<string> {
        const config = loadClientConfig(clientId);
        const service = this.getProvider(config);

        const event: Partial<CalendarEvent> = {
            summary: `${request.customerName} - ${request.customerPhone}`,
            description: request.description,
            start: request.startTime,
            end: request.endTime
        };

        const createdEvent = await service.createEvent(clientId, event);

        // Cache it using Repository
        this.cache.save({
            client_id: clientId,
            calendar_event_id: createdEvent.id,
            provider: config.calendar.provider,
            customer_name: request.customerName,
            customer_phone: request.customerPhone,
            appointment_datetime: request.startTime,
            end_datetime: request.endTime,
            duration_minutes: (new Date(request.endTime).getTime() - new Date(request.startTime).getTime()) / 60000,
            status: 'confirmed'
        });

        return createdEvent.id;
    }
}
