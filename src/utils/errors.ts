export class AppError extends Error {
    public readonly code: string;
    public readonly meta: any;

    constructor(message: string, code: string = 'INTERNAL_ERROR', meta: any = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.meta = meta;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class TelephonyError extends AppError {
    constructor(message: string, meta: any = {}) {
        super(message, 'TELEPHONY_ERROR', meta);
    }
}

export class AIError extends AppError {
    constructor(message: string, meta: any = {}) {
        super(message, 'AI_ERROR', meta);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, meta: any = {}) {
        super(message, 'DATABASE_ERROR', meta);
    }
}

export class ConfigError extends AppError {
    constructor(message: string, meta: any = {}) {
        super(message, 'CONFIG_ERROR', meta);
    }
}
