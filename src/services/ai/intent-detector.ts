import { LLMService } from './llm';

export type Intent = 'book_appointment' | 'reschedule' | 'cancel' | 'general_inquiry' | 'unknown';

export class IntentDetector {
    private llm: LLMService;

    constructor() {
        this.llm = new LLMService();
    }

    async detectIntent(text: string): Promise<Intent> {
        const prompt = `
        Classify the following user input into one of these intents:
        - book_appointment (wants to schedule service)
        - reschedule (change existing appointment)
        - cancel (cancel appointment)
        - general_inquiry (asking about hours, location, services)
        - unknown (not clear)

        Input: "${text}"
        
        Return ONLY the intent name.`;

        const response = await this.llm.generateResponse([
            { role: 'user', content: prompt }
        ], "You are an intent classifier. Output only the class label.");

        const cleaned = response.trim().toLowerCase();
        if (['book_appointment', 'reschedule', 'cancel', 'general_inquiry', 'unknown'].includes(cleaned)) {
            return cleaned as Intent;
        }
        return 'unknown';
    }
}
