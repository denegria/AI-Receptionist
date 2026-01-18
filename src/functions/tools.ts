export const TOOLS = [
    {
        name: "check_availability",
        description: "Check if a time slot is available for an appointment. Always check availability before booking.",
        input_schema: {
            type: "object",
            properties: {
                startTime: {
                    type: "string",
                    description: "Start time in ISO 8601 format (e.g., 2024-05-20T10:00:00Z)"
                },
                endTime: {
                    type: "string",
                    description: "End time in ISO 8601 format"
                }
            },
            required: ["startTime", "endTime"]
        }
    },
    {
        name: "book_appointment",
        description: "Book a new appointment after confirming availability.",
        input_schema: {
            type: "object",
            properties: {
                customerName: {
                    type: "string",
                    description: "Name of the customer"
                },
                customerPhone: {
                    type: "string",
                    description: "Phone number of the customer"
                },
                startTime: {
                    type: "string",
                    description: "Start time in ISO 8601 format"
                },
                endTime: {
                    type: "string",
                    description: "End time in ISO 8601 format"
                },
                description: {
                    type: "string",
                    description: "Description of the service needed"
                }
            },
            required: ["customerName", "customerPhone", "startTime", "endTime"]
        }
    },
    {
        name: 'take_voicemail',
        description: 'Transfers the caller to a voicemail recording. Use this if the caller wants to leave a detailed message, if you are unable to help, or if the caller wants to speak to a person.',
        input_schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief reason for taking voicemail' }
            }
        }
    }
];
