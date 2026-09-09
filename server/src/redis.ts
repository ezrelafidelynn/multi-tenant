import IORedis from 'ioredis';
import { config } from './config.js';

/** BullMQ requires maxRetriesPerRequest = null on the shared connection. */
export const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on('error', (err) => console.error('[redis]', err.message));
