import { Redis } from 'ioredis';
import { config } from './config.js';

/** BullMQ requires maxRetriesPerRequest = null on the shared connection. */
export const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on('error', (err: Error) => console.error('[redis]', err.message));
