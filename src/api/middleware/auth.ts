import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

/**
 * Simple API Key authentication middleware
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];

  const providedKey = apiKey || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader);

  if (!providedKey || providedKey !== config.admin.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};
