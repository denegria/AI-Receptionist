import { getClientDatabase } from '../client';

export interface ConversationTurn {
    id?: number;
    call_sid: string;
    turn_number: number;
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
}

export class ConversationTurnRepository {
    create(turn: ConversationTurn & { client_id: string }): void {
        const db = getClientDatabase(turn.client_id);
        const stmt = db.prepare(`
            INSERT INTO conversation_turns (call_sid, turn_number, role, content)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(turn.call_sid, turn.turn_number, turn.role, turn.content);
    }

    findByCallSid(callSid: string, clientId: string): ConversationTurn[] {
        const db = getClientDatabase(clientId);
        const stmt = db.prepare(`
            SELECT * FROM conversation_turns 
            WHERE call_sid = ? 
            ORDER BY turn_number ASC
        `);
        return stmt.all(callSid) as ConversationTurn[];
    }
}

export const conversationTurnRepository = new ConversationTurnRepository();
