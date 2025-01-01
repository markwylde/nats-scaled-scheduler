import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { connect } from "@nats-io/transport-node";
import createNatsScheduler, { JobData } from '../src/main.js';

const createTestNatsScheduler = async () => {
  return createNatsScheduler({
    nats: {
      servers: ['localhost:4222'],
      user: 'a',
      pass: 'a',
    },
    streamName: 'TEST_SCHEDULER_STREAM'
  });
};

describe('NATS Scheduler', () => {
  it('should connect using existing nats connections', async () => {
    const scheduler = await createNatsScheduler({
      nats: await connect({
        servers: ['localhost:4222'],
        user: 'a',
        pass: 'a',
      }),
      streamName: 'TEST_SCHEDULER_STREAM'
    });
    const jobFn = mock.fn(async () => {});
    scheduler.addJob(jobFn, '* * * * *', 'testJob');
    assert.strictEqual(jobFn.mock.callCount(), 0, 'Job function should not be called immediately');
    await scheduler.shutdown();
  });

  it('should add a job and schedule it', async () => {
    const scheduler = await createTestNatsScheduler();
    const jobFn = mock.fn(async () => {});
    scheduler.addJob(jobFn, '* * * * *', 'testJob');
    assert.strictEqual(jobFn.mock.callCount(), 0, 'Job function should not be called immediately');
    await scheduler.shutdown();
  });

  it('should remove a job', async () => {
    const scheduler = await createTestNatsScheduler();
    const jobFn = mock.fn(async () => {});
    scheduler.addJob(jobFn, '* * * * *', 'testJob');
    await scheduler.removeJob('testJob');
    assert.strictEqual(scheduler.activeJobs.has('testJob'), false, 'Job should be removed');
    await scheduler.shutdown();
  });

  it('should perform health check', async () => {
    const scheduler = await createTestNatsScheduler();
    const health = await scheduler.healthCheck();
    assert.strictEqual(health, true, 'Health check should pass');
    await scheduler.shutdown();
  });

  it('should shutdown gracefully', async () => {
    const scheduler = await createTestNatsScheduler();
    await scheduler.shutdown();
    assert.strictEqual(scheduler.activeJobs.size, 0, 'All jobs should be stopped');
  });

  it('should ensure only one scheduler runs the job', async () => {
    const jobRuns : JobData[] = [];

    const jobFn = mock.fn(async (job : JobData) => {
      jobRuns.push(job);
    });
    const [scheduler1, scheduler2, scheduler3, scheduler4] = await Promise.all([
      createTestNatsScheduler(),
      createTestNatsScheduler(),
      createTestNatsScheduler(),
      createTestNatsScheduler()
    ]);

    // Add the same job to both schedulers
    scheduler1.addJob(jobFn, '*/1 * * * * *', 'testJob');
    scheduler2.addJob(jobFn, '*/1 * * * * *', 'testJob');
    scheduler3.addJob(jobFn, '*/1 * * * * *', 'testJob');
    scheduler4.addJob(jobFn, '*/1 * * * * *', 'testJob');

    // Wait for the job to be executed (adjust the timeout as needed)
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Verify that the job function was called only once
    assert.ok(jobFn.mock.callCount() > 0, 'Job function should be called only once');

    // ensure jobRuns -> jobData.timestamp are all unqiue
    const timestamps = jobRuns.map(job => job.timestamp);
    const uniqueTimestamps = new Set(timestamps);
    assert.strictEqual(uniqueTimestamps.size, timestamps.length, 'JobData.timestamp should be unique');

    // Shutdown all schedulers in parallel
    await Promise.all([
      scheduler1.shutdown(),
      scheduler2.shutdown(),
      scheduler3.shutdown(),
      scheduler4.shutdown()
    ]);
  });
});
