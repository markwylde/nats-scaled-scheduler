import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { connect } from "@nats-io/transport-node";
import { createNatsQueue } from '../src/main.js';

const createTestQueue = async () => {
  return createNatsQueue({
    nats: {
      servers: ['localhost:4222'],
      user: 'a',
      pass: 'a',
    },
    name: 'TEST_QUEUE'
  });
};

describe('NATS Queue', () => {
  it('should connect using existing nats connections', async () => {
    const queue = await createNatsQueue({
      nats: await connect({
        servers: ['localhost:4222'],
        user: 'a',
        pass: 'a',
      }),
      name: 'TEST_QUEUE'
    });

    const handler = mock.fn(async () => {});
    queue.process('testQueue', handler);
    assert.strictEqual(handler.mock.callCount(), 0, 'Handler should not be called without messages');
    await new Promise(resolve => setTimeout(resolve, 250));
    await queue.shutdown();
  });

  it('should process jobs in order', async () => {
    const queue = await createTestQueue();
    const processedJobs: any[] = [];

    const handler = mock.fn(async (job) => {
      processedJobs.push(job.data);
    });

    queue.process('testQueue', handler);

    const jobs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await queue.pushBatch('testQueue', jobs);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 250));

    assert.strictEqual(handler.mock.callCount(), 3, 'All jobs should be processed');
    assert.deepStrictEqual(
      processedJobs.map(job => job.id),
      [1, 2, 3],
      'Jobs should be processed in order'
    );

    await queue.shutdown();
  });

  it('should respect concurrency limits', async () => {
    const queue = await createTestQueue();
    let concurrentJobs = 0;
    let maxConcurrentJobs = 0;

    const handler = mock.fn(async () => {
      concurrentJobs++;
      maxConcurrentJobs = Math.max(maxConcurrentJobs, concurrentJobs);
      await new Promise(resolve => setTimeout(resolve, 100));
      concurrentJobs--;
    });

    queue.process('testQueue', { concurrency: 2 }, handler);

    // Push 5 jobs
    await queue.pushBatch('testQueue', [1, 2, 3, 4, 5]);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 250));

    assert.strictEqual(maxConcurrentJobs, 2, 'Should not exceed concurrency limit');
    assert.strictEqual(handler.mock.callCount(), 5, 'All jobs should be processed');

    await queue.shutdown();
  });

  it('should ensure each job is processed only once across multiple consumers', async () => {
    const processedJobs = new Set();
    const handler = mock.fn(async (job) => {
      processedJobs.add(job.id);
    });

    const [queue1, queue2, queue3] = await Promise.all([
      createTestQueue(),
      createTestQueue(),
      createTestQueue(),
    ]);

    // Set up processors on all queues
    queue1.process('testQueue', handler);
    queue2.process('testQueue', handler);
    queue3.process('testQueue', handler);

    // Push some test jobs
    const jobIds = await queue1.pushBatch('testQueue', [
      { test: 1 },
      { test: 2 },
      { test: 3 },
      { test: 4 },
      { test: 5 },
    ]);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    assert.strictEqual(
      handler.mock.callCount(),
      jobIds.length,
      'Each job should be processed exactly once'
    );

    assert.strictEqual(
      processedJobs.size,
      jobIds.length,
      'No duplicate processing should occur'
    );

    await Promise.all([
      queue1.shutdown(),
      queue2.shutdown(),
      queue3.shutdown(),
    ]);
  });

  it('should handle job failures and retries', async () => {
    const queue = await createTestQueue();
    let attempts = 0;

    const handler = mock.fn(async (job) => {
      attempts++;
      if (attempts <= 2) {
        throw new Error('Temporary failure');
      }
    });

    queue.process('testQueue', handler);

    const jobId = await queue.push('testQueue', { test: 1 }, { retries: 2 });

    // Wait for processing and retries
    await new Promise(resolve => setTimeout(resolve, 1000));

    assert.strictEqual(attempts, 3, 'Job should be retried twice');
    assert.strictEqual(handler.mock.callCount(), 3, 'Handler should be called three times');

    await queue.shutdown();
  });

  it('should pause and resume processing', async () => {
    const queue = await createTestQueue();
    const handler = mock.fn(async () => {});

    queue.process('testQueue', handler);

    // Push a job and pause immediately
    await queue.push('testQueue', { test: 1 });
    await queue.pause('testQueue');

    // Wait a bit and verify no processing
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.strictEqual(handler.mock.callCount(), 0, 'No jobs should be processed while paused');

    // Resume and verify processing
    await queue.resume('testQueue');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.strictEqual(handler.mock.callCount(), 1, 'Job should be processed after resume');

    await queue.shutdown();
  });
});
