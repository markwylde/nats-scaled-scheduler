# NATS Scaled Scheduler

`nats-scaled-scheduler` provides two powerful distributed systems built on top of NATS JetStream:
1. A distributed job scheduler for running cron-based tasks
2. A distributed job queue for processing work across multiple instances

## Installation

```bash
npm install nats-scaled-scheduler
```

## Scheduler Usage

The scheduler allows you to run cron-based jobs across multiple instances in a fault-tolerant manner.

```javascript
import { createNatsScheduler } from 'nats-scaled-scheduler';

const scheduler = await createNatsScheduler({
  nats: {
    servers: ['localhost:4222'],
    user: 'a',
    pass: 'a',
  },
  streamName: 'MY_SCHEDULER'
});

// Add a job that runs every minute
await scheduler.addJob(async (data) => {
  console.log('Scheduled job running:', data);
}, '* * * * *', 'myJob');

// Remove a job
await scheduler.removeJob('myJob');

// Shutdown
await scheduler.shutdown();
```

### Scheduler API

- **createNatsScheduler(options)**
  - `options.nats`: NATS connection options or existing connection
  - `options.streamName`: Name for the scheduler stream

- **scheduler.addJob(fn, cron, name)**
  - `fn`: Async function to execute
  - `cron`: Cron expression
  - `name`: Unique job name

- **scheduler.removeJob(name)**
- **scheduler.healthCheck()**
- **scheduler.shutdown()**

## Queue Usage

The queue system allows you to process jobs across multiple workers with features like retries and concurrency control.

```javascript
import { createNatsQueue } from 'nats-scaled-scheduler';

const queue = await createNatsQueue({
  nats: {
    servers: ['localhost:4222'],
    user: 'a',
    pass: 'a',
  },
  name: 'MY_QUEUE'
});

// Add a job processor
queue.process('emails', { concurrency: 5 }, async (job) => {
  await sendEmail(job.data);
});

// Add jobs to the queue
await queue.push('emails', {
  to: 'user@example.com',
  subject: 'Hello'
}, {
  priority: 'high',
  delay: '5m',
  retries: 3
});

// Process multiple items
await queue.pushBatch('emails', [
  { to: 'user1@example.com' },
  { to: 'user2@example.com' }
]);

// Get queue stats
const stats = await queue.getStats('emails');
console.log(stats);

// Shutdown
await queue.shutdown();
```

### Queue API

- **createNatsQueue(options)**
  - `options.nats`: NATS connection options or existing connection
  - `options.name`: Name for the queue stream

- **queue.push(queueName, data, options)**
  - `queueName`: Name of the queue
  - `data`: Job payload
  - `options.priority`: 'low' | 'medium' | 'high'
  - `options.delay`: Delay time (e.g., '5m', '1h')
  - `options.retries`: Number of retry attempts

- **queue.pushBatch(queueName, items, options)**
- **queue.process(queueName, options, handler)**
  - `options.concurrency`: Number of concurrent jobs
- **queue.pause(queueName)**
- **queue.resume(queueName)**
- **queue.clear(queueName)**
- **queue.getStats(queueName)**
- **queue.shutdown()**

## Events
The queue emits the following events:
- `'completed'`: When a job completes successfully
- `'error'`: When a job fails

## Running Tests

```bash
npm test
```

## Docker Setup

To run a local NATS server:

```bash
docker-compose up
```

This will start the required NATS servers in a cluster configuration.
