import { connect, ConnectionOptions, NatsConnection } from "@nats-io/transport-node";
import {
  jetstream,
  jetstreamManager,
  AckPolicy,
  ConsumerMessages,
  JetStreamClient,
  JetStreamManager,
  RetentionPolicy
} from "@nats-io/jetstream";
import { EventEmitter } from 'events';
import ms from 'ms';

export interface NatsQueueOptions {
  nats: ConnectionOptions | NatsConnection;
  name: string;
}

export interface JobOptions {
  priority?: 'low' | 'medium' | 'high';
  delay?: string | number;
  retries?: number;
}

export interface Job<T = any> {
  id: string;
  data: T;
  queue: string;
  attempts: number;
  options: JobOptions;
  timestamp: number;
}

export interface ProcessOptions {
  concurrency?: number;
}

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface Queue {
  push: <T>(queue: string, data: T, options?: JobOptions) => Promise<string>;
  pushBatch: <T>(queue: string, items: T[], options?: JobOptions) => Promise<string[]>;
  process: <T>(queue: string, options: ProcessOptions | JobHandler<T>, handler?: JobHandler<T>) => void;
  pause: (queue: string) => Promise<void>;
  resume: (queue: string) => Promise<void>;
  clear: (queue: string) => Promise<void>;
  getStats: (queue: string) => Promise<QueueStats>;
  shutdown: () => Promise<void>;
  on: (event: 'error' | 'completed', handler: (data: any) => void) => void;
}

export const createNatsQueue = async (options: NatsQueueOptions): Promise<Queue> => {
  const emitter = new EventEmitter();
  const nc: NatsConnection = (options.nats as NatsConnection).isClosed === undefined
    ? await connect(options.nats as ConnectionOptions)
    : (options.nats as NatsConnection);
  const js: JetStreamClient = jetstream(nc);
  const jsm: JetStreamManager = await jetstreamManager(nc);

  const handlers = new Map<string, { fn: JobHandler, options: ProcessOptions }>();
  const processing = new Map<string, number>();
  const stats = new Map<string, QueueStats>();
  const paused = new Set<string>();
  const activeConsumers: ConsumerMessages[] = [];

  // Initialize stream if it doesn't exist
  await jsm.streams.add({
    name: options.name,
    subjects: [`${options.name}.*`],
    retention: RetentionPolicy.Workqueue,
  }).catch(() => {});

  // Create a durable consumer for the queue
  await jsm.consumers.add(options.name, {
    durable_name: "queue_consumer",
    ack_policy: AckPolicy.Explicit,
  }).catch(() => {});

  const push = async <T>(queue: string, data: T, jobOptions: JobOptions = {}): Promise<string> => {
    const job: Job<T> = {
      id: Math.random().toString(36).substring(7),
      data,
      queue,
      attempts: 0,
      options: jobOptions,
      timestamp: Date.now()
    };

    const subject = `${options.name}.${queue}`;
    const msgID = `${job.id}-${job.timestamp}`;

    if (jobOptions.delay) {
      const delay = typeof jobOptions.delay === 'string' ?
        ms(jobOptions.delay) :
        jobOptions.delay;

      await js.publish(subject, JSON.stringify(job), {
        msgID,
        timeout: delay
      });
    } else {
      await js.publish(subject, JSON.stringify(job), {
        msgID
      });
    }

    return job.id;
  };

  const pushBatch = async <T>(queue: string, items: T[], jobOptions: JobOptions = {}) => {
    return Promise.all(items.map(item => push(queue, item, jobOptions)));
  };

  const updateStats = (queue: string, stat: keyof QueueStats, delta: number) => {
    const current = stats.get(queue) || {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };
    current[stat] += delta;
    stats.set(queue, current);
  };

  const consumeMessages = async () => {
    const consumer = await js.consumers.get(options.name, "queue_consumer");
    const queueHandlers = Array.from(handlers.entries());

    for (const [queueName, { options: procOptions }] of queueHandlers) {
      const maxConcurrent = procOptions.concurrency || 1;

      for (let i = 0; i < maxConcurrent; i++) {
        (async () => {
          const messages = await consumer.consume({
            max_messages: 1,
          });

          activeConsumers.push(messages);

          for await (const msg of messages) {
            try {
              const queue = msg.subject.split('.').pop() as string;
              if (queue !== queueName || paused.has(queue)) {
                await msg.nak();
                continue;
              }

              const job: Job = JSON.parse(msg.data.toString());
              const handler = handlers.get(queue);

              if (handler) {
                const { fn } = handler;
                processing.set(queue, (processing.get(queue) || 0) + 1);
                updateStats(queue, 'processing', 1);

                try {
                  await fn(job);
                  emitter.emit('completed', job.id);
                  updateStats(queue, 'completed', 1);
                  await msg.ack();
                } catch (error) {
                  if (job.attempts < (job.options.retries || 0)) {
                    job.attempts++;
                    await push(queue, job.data, job.options);
                    await msg.ack();
                  } else {
                    emitter.emit('error', error, job.id);
                    updateStats(queue, 'failed', 1);
                    await msg.term();
                  }
                } finally {
                  processing.set(queue, (processing.get(queue) || 0) - 1);
                  updateStats(queue, 'processing', -1);
                }
              }
            } catch (error) {
              console.error('Error processing message:', error);
              await msg.term();
            }
          }
        })();
      }
    }
  };

  const process = <T>(
    queue: string,
    optionsOrHandler: ProcessOptions | JobHandler<T>,
    handlerOrUndefined?: JobHandler<T>
  ) => {
    const procOptions: ProcessOptions = typeof optionsOrHandler === 'function'
      ? { concurrency: 1 }
      : optionsOrHandler;

    const handler: JobHandler<T> = typeof optionsOrHandler === 'function'
      ? optionsOrHandler
      : handlerOrUndefined!;

    handlers.set(queue, { fn: handler, options: procOptions });
    processing.set(queue, 0);
    stats.set(queue, {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    });

    // Start consuming messages when a handler is added
    consumeMessages().catch(err => console.error('Error consuming messages:', err));
  };

  return {
    push,
    pushBatch,
    process,
    pause: async (queue: string) => {
      paused.add(queue);
    },
    resume: async (queue: string) => {
      paused.delete(queue);
    },
    clear: async (queue: string) => {
      await jsm.streams.purge(options.name, {
        filter: `${options.name}.${queue}`
      });
    },
    getStats: async (queue: string) => {
      return stats.get(queue) || {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      };
    },
    shutdown: async () => {
      // Close all active consumers
      await Promise.all(activeConsumers.map(consumer => consumer.close()));
      activeConsumers.length = 0;

      // Close the connection
      await nc.close();
    },
    on: (event: string, handler: (data: any) => void) => {
      emitter.on(event, handler);
    }
  };
};

export default createNatsQueue;
