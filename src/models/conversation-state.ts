export interface ConversationState {
    callSid: string;
    status: 'greeting' | 'collecting_info' | 'booking' | 'confirmed' | 'ended';
    transcript: string[];
    collectedData: {
        name?: string;
        phone?: string;
        serviceType?: string;
        desiredTime?: string;
    };
    lastIntent?: string;
    retryCount: number;
}
