export const TOOLS = [
    {
        name: "check_availability",
        description: "Check if a time slot is available for an appointment. Always check availability before booking.",
        input_schema: {
            type: "object",
            properties: {
                startTime: {
                    type: "string",
                    description: "Start time in ISO 8601 format with offset (e.g., 2024-05-20T10:00:00-05:00)"
                },
                endTime: {
                    type: "string",
                    description: "End time in ISO 8601 format with offset"
                }
            },
            required: ["startTime", "endTime"]
        }
    },
    {
        name: "book_appointment",
        description: "Book a new appointment after confirming availability. NEVER call this tool until the user has explicitly confirmed the details (e.g. said 'Yes', 'Go ahead', etc.) after you have read them back.",
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
                customerEmail: {
                    type: "string",
                    description: "Email address of the customer for the calendar invite"
                },
                startTime: {
                    type: "string",
                    description: "Start time in ISO 8601 format with offset (e.g. 2024-05-20T10:00:00-05:00). Do NOT use 'Z'."
                },
                endTime: {
                    type: "string",
                    description: "End time in ISO 8601 format with offset (e.g. 2024-05-20T11:00:00-05:00)"
                },
                description: {
                    type: "string",
                    description: "Description of the service needed"
                }
            },
            required: ["customerName", "customerPhone", "customerEmail", "startTime", "endTime"]
        }
    },
    {
        name: 'take_voicemail',
        description: 'Transfers the caller to a voicemail recording. Use this if the caller wants to leave a detailed message or if you are unable to help.',
        input_schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief reason for taking voicemail' }
            }
        }
    }
];
