# NATS Scaled Scheduler

`nats-scaled-scheduler` is a distributed job scheduler built on top of NATS JetStream. It allows you to schedule and run jobs across multiple instances in a scalable and fault-tolerant manner. The scheduler ensures that only one instance runs a job at a time, even if multiple instances are running the same job.

## Features

- **Distributed Scheduling**: Schedule jobs across multiple instances.
- **Fault Tolerance**: Jobs are executed reliably even if some instances fail.
- **Cron Expressions**: Schedule jobs using cron expressions.
- **Scalability**: Add more instances to handle increased job load.
- **Health Check**: Monitor the health of the scheduler.
- **Graceful Shutdown**: Stop all jobs gracefully when shutting down.

## Installation

```bash
npm install nats-scaled-scheduler
```

## Usage

### Basic Example

```javascript
import createNatsScheduler from 'nats-scaled-scheduler';

const scheduler = await createNatsScheduler({
  options: {
    servers: ['localhost:4222'],
    user: 'a',
    pass: 'a',
  },
  streamName: 'TEST_SCHEDULER_STREAM'
});

const jobFn = async (data) => {
  console.log('Job executed with data:', data);
};

// Add a job that runs every minute
await scheduler.addJob(jobFn, '* * * * *', 'testJob');

// Perform a health check
const health = await scheduler.healthCheck();
console.log('Health check:', health);

// Remove the job
await scheduler.removeJob('testJob');

// Shutdown the scheduler
await scheduler.shutdown();
```

### Advanced Example

```javascript
import { createNatsScheduler } from 'nats-scaled-scheduler';

const scheduler1 = await createNatsScheduler({
  options: {
    servers: ['localhost:4222'],
    user: 'a',
    pass: 'a',
  },
  streamName: 'TEST_SCHEDULER_STREAM'
});

const scheduler2 = await createNatsScheduler({
  options: {
    servers: ['localhost:4222'],
    user: 'a',
    pass: 'a',
  },
  streamName: 'TEST_SCHEDULER_STREAM'
});

const jobFn = async (data) => {
  console.log('Job executed with data:', data);
};

// Add the same job to both schedulers
await scheduler1.addJob(jobFn, '*/1 * * * * *', 'testJob');
await scheduler2.addJob(jobFn, '*/1 * * * * *', 'testJob');

// Wait for the job to be executed
await new Promise(resolve => setTimeout(resolve, 1200));

// Shutdown both schedulers
await scheduler1.shutdown();
await scheduler2.shutdown();
```

## API

### `createNatsScheduler(options: NatsSchedulerOptions): Promise<NatsScheduler>`

Creates a new NATS scheduler instance.

#### Parameters

- `options`: An object containing the following properties:
  - `options`: NATS connection options.
  - `streamName`: The name of the JetStream stream to use for scheduling.

#### Returns

A `NatsScheduler` instance.

### `NatsScheduler`

An instance of the NATS scheduler with the following methods:

#### `addJob(jobFn: JobFunction, cronExpression: string, jobName: string): Promise<void>`

Adds a new job to the scheduler.

- `jobFn`: The function to execute when the job runs.
- `cronExpression`: The cron expression defining the job schedule.
- `jobName`: A unique name for the job.

#### `removeJob(jobName: string): Promise<void>`

Removes a job from the scheduler.

- `jobName`: The name of the job to remove.

#### `healthCheck(): Promise<boolean>`

Performs a health check on the scheduler.

#### `shutdown(): Promise<void>`

Shuts down the scheduler, stopping all jobs.

#### `activeJobs: Map<string, JobEntry>`

A map of active jobs, where the key is the job name and the value is an object containing the job function and cron expression.

## Running the Tests

To run the tests, use the following command:

```bash
npm test
```

## Docker Setup

To run a local NATS server cluster using Docker, use the provided `docker-compose.yml` file:

```bash
docker-compose up
```

This will start two NATS servers in a cluster configuration.
