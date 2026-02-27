import { createClient, RedisClientType } from 'redis';
import { config } from '../../config';
import { logger } from '../logging';

export class RedisCoordinator {
    private client: RedisClientType | null = null;
    private connected = false;

    async init(): Promise<void> {
        if (!config.redis.url) {
            logger.warn('Redis disabled (REDIS_URL not set), coordination running in local-only mode');
            return;
        }

        this.client = createClient({ url: config.redis.url });
        this.client.on('error', (error) => logger.error('Redis client error', { error }));
        await this.client.connect();
        this.connected = true;
        logger.info('Redis coordinator connected');
    }

    async close(): Promise<void> {
        if (this.client && this.connected) {
            await this.client.quit();
            this.connected = false;
        }
    }

    async markWebhookProcessed(key: string): Promise<boolean> {
        if (!this.client || !this.connected) return true;
        const result = await this.client.set(
            `idem:webhook:${key}`,
            '1',
            { NX: true, EX: config.redis.webhookIdempotencyTtlSeconds }
        );
        return result === 'OK';
    }

    async admitCall(callSid: string, clientId: string): Promise<{ admitted: boolean; queued: boolean }> {
        if (!this.client || !this.connected) return { admitted: true, queued: false };

        const globalKey = 'active:global';
        const tenantKey = `active:tenant:${clientId}`;
        const sessionKey = `session:${callSid}`;

        const results = await this.client
            .multi()
            .incr(globalKey)
            .expire(globalKey, config.redis.activeSessionTtlSeconds)
            .incr(tenantKey)
            .expire(tenantKey, config.redis.activeSessionTtlSeconds)
            .set(sessionKey, clientId, { EX: config.redis.activeSessionTtlSeconds })
            .exec() as any[];

        const g = Number(results[0]);
        const t = Number(results[2]);

        if (g <= config.admission.maxGlobalActiveCalls && t <= config.admission.maxTenantActiveCalls) {
            return { admitted: true, queued: false };
        }

        await this.releaseCall(callSid, clientId);

        if (config.admission.queueEnabled) {
            const queueKey = `queue:tenant:${clientId}`;
            const size = await this.client.lLen(queueKey);
            if (size < config.admission.queueMaxSize) {
                await this.client.rPush(queueKey, callSid);
                await this.client.expire(queueKey, config.redis.activeSessionTtlSeconds);
                return { admitted: false, queued: true };
            }
        }

        return { admitted: false, queued: false };
    }

    async refreshCall(callSid: string, clientId: string): Promise<void> {
        if (!this.client || !this.connected) return;
        await this.client.multi()
            .expire(`session:${callSid}`, config.redis.activeSessionTtlSeconds)
            .expire('active:global', config.redis.activeSessionTtlSeconds)
            .expire(`active:tenant:${clientId}`, config.redis.activeSessionTtlSeconds)
            .exec();
    }

    async releaseCall(callSid: string, clientId: string): Promise<void> {
        if (!this.client || !this.connected) return;
        await this.client.multi()
            .del(`session:${callSid}`)
            .decr('active:global')
            .decr(`active:tenant:${clientId}`)
            .exec();
    }
}

export const redisCoordinator = new RedisCoordinator();
