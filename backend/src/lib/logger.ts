import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'xau-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ['*.token', '*.password', '*.pass', '*.authToken', 'headers.authorization'],
});

export type Logger = typeof logger;
