import { logger } from '../logging';

export enum CallState {
    INIT = 'INIT',
    GREETING = 'GREETING',
    INTENT_DETECTION = 'INTENT_DETECTION',
    INFO_CAPTURE = 'INFO_CAPTURE',
    CONFIRMATION = 'CONFIRMATION',
    HANDOFF = 'HANDOFF',
    TERMINATED = 'TERMINATED'
}

export class CallStateManager {
    private currentState: CallState = CallState.INIT;
    private callSid: string;

    constructor(callSid: string) {
        this.callSid = callSid;
    }

    public getState(): CallState {
        return this.currentState;
    }

    public transitionTo(newState: CallState) {
        if (this.currentState === newState) return;

        // Validation: Cannot transition out of TERMINATED
        if (this.currentState === CallState.TERMINATED) {
            logger.warn(`Attempted to transition from TERMINATED to ${newState}`, { callSid: this.callSid });
            return;
        }

        logger.info(`State Transition: ${this.currentState} -> ${newState}`, {
            callSid: this.callSid,
            from: this.currentState,
            to: newState
        });

        this.currentState = newState;
    }
}
