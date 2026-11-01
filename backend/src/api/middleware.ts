/**
 * api/middleware.ts  —  Express middlewares: auth, rate-limiting, error handler.
 */
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

// ── Bearer-token authentication ────────────────────────────────────────────

export function auth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = header?.startsWith('Bearer ')
    ? header.slice(7)
    : req.query?.['token'] as string | undefined;

  if (!token || token !== env.ADMIN_TOKEN) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }
  next();
}

// ── Rate limiter ───────────────────────────────────────────────────────────

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// ── Async handler wrapper ──────────────────────────────────────────────────

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

// ── Central error handler ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const status = (err as any).status ?? 500;
  const msg = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(status).json({ error: msg });
}
