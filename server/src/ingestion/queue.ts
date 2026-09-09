import { Queue, type JobsOptions } from 'bullmq';
import { connection } from '../redis.js';
import { config } from '../config.js';

export interface IngestJobData {
  documentId: string;
  organizationId: string;
  storageKey: string;
  contentType: string;
  filename: string;
}

export const ingestQueue = new Queue<IngestJobData>(config.ingestQueue, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});

export function enqueueIngest(data: IngestJobData, opts?: JobsOptions) {
  // jobId = documentId => uploading the same doc twice won't double-index it
  return ingestQueue.add('ingest', data, { jobId: data.documentId, ...opts });
}
