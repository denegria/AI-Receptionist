import { getClientDatabase } from '../client';

export interface ClientMetric {
    id?: number;
    client_id: string;
    metric_name: string;
    metric_value: number;
    metadata?: string;
    timestamp?: string;
}

export type MetricName =
    | 'call_count'
    | 'call_duration'
    | 'tokens_input'
    | 'tokens_output'
    | 'booking_success'
    | 'booking_failed'
    | 'voice_webhook_ok'
    | 'voice_webhook_error'
    | 'stream_connect_ok'
    | 'stream_connect_error'
    | 'fallback_triggered';

export class MetricsRepository {
    /**
     * Track a metric for a client
     */
    track(clientId: string, metricName: MetricName, value: number, metadata?: Record<string, any>): void {
        const db = getClientDatabase(clientId);
        const stmt = db.prepare(`
            INSERT INTO client_metrics (client_id, metric_name, metric_value, metadata)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(
            clientId,
            metricName,
            value,
            metadata ? JSON.stringify(metadata) : null
        );
    }

    /**
     * Get metrics for a client within a date range
     */
    getMetrics(
        clientId: string,
        metricName: MetricName,
        startDate?: string,
        endDate?: string
    ): ClientMetric[] {
        const db = getClientDatabase(clientId);
        let query = 'SELECT * FROM client_metrics WHERE client_id = ? AND metric_name = ?';
        const params: any[] = [clientId, metricName];

        if (startDate) {
            query += ' AND timestamp >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND timestamp <= ?';
            params.push(endDate);
        }

        query += ' ORDER BY timestamp DESC';

        const stmt = db.prepare(query);
        return stmt.all(...params) as ClientMetric[];
    }

    /**
     * Get daily summary for a client
     */
    getDailySummary(clientId: string, date: string): Record<MetricName, number> {
        const db = getClientDatabase(clientId);
        const startOfDay = `${date} 00:00:00`;
        const endOfDay = `${date} 23:59:59`;

        const stmt = db.prepare(`
            SELECT metric_name, SUM(metric_value) as total
            FROM client_metrics
            WHERE client_id = ? AND timestamp >= ? AND timestamp <= ?
            GROUP BY metric_name
        `);

        const results = stmt.all(clientId, startOfDay, endOfDay) as Array<{
            metric_name: MetricName;
            total: number;
        }>;

        const summary: Record<string, number> = {};
        for (const row of results) {
            summary[row.metric_name] = row.total;
        }

        return summary as Record<MetricName, number>;
    }

    /**
     * Get aggregated stats for a metric
     */
    getAggregated(
        clientId: string,
        metricName: MetricName,
        startDate?: string,
        endDate?: string
    ): { sum: number; avg: number; count: number; min: number; max: number } {
        const db = getClientDatabase(clientId);
        let query = `
            SELECT 
                SUM(metric_value) as sum,
                AVG(metric_value) as avg,
                COUNT(*) as count,
                MIN(metric_value) as min,
                MAX(metric_value) as max
            FROM client_metrics
            WHERE client_id = ? AND metric_name = ?
        `;
        const params: any[] = [clientId, metricName];

        if (startDate) {
            query += ' AND timestamp >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND timestamp <= ?';
            params.push(endDate);
        }

        const stmt = db.prepare(query);
        const result = stmt.get(...params) as any;

        return {
            sum: result.sum || 0,
            avg: result.avg || 0,
            count: result.count || 0,
            min: result.min || 0,
            max: result.max || 0
        };
    }
}

export const metricsRepository = new MetricsRepository();
