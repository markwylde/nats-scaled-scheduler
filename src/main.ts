import { connect, NatsConnection, ConnectionOptions } from "@nats-io/transport-node";
import { jetstream, jetstreamManager, AckPolicy, ConsumerMessages, JetStreamClient, JetStreamManager, RetentionPolicy } from "@nats-io/jetstream";
import cronParser from 'cron-parser';

// Define the structure of job data
export interface JobData {
  timestamp: number;
  instance: string;
}

// Define the structure of a job function
export type JobFunction = (data: JobData) => Promise<void>;

// Define the structure of a job entry in the activeJobs map
interface JobEntry {
  jobFn: JobFunction;
  cronExpression: string;
}

// Define the structure of the options for creating a NATS scheduler
interface NatsSchedulerOptions {
  nats: ConnectionOptions | NatsConnection;
  streamName: string;
}

// Define the structure of the NATS scheduler
interface NatsScheduler {
  addJob: (jobFn: JobFunction, cronExpression: string, jobName: string) => Promise<void>;
  removeJob: (jobName: string) => Promise<void>;
  healthCheck: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  activeJobs: Map<string, JobEntry>;
}

export const createNatsScheduler = async ({ nats, streamName }: NatsSchedulerOptions): Promise<NatsScheduler> => {
  const nc: NatsConnection = (nats as NatsConnection).isClosed === undefined
    ? await connect(nats as ConnectionOptions)
    : (nats as NatsConnection);

  const js: JetStreamClient = jetstream(nc);
  const jsm: JetStreamManager = await jetstreamManager(nc);

  // Initialize stream if it doesn't exist
  await jsm.streams.add({
    name: streamName,
    subjects: [`${streamName}.*`],
    retention: RetentionPolicy.Workqueue,
  });

  // Create a durable consumer for the scheduler
  await jsm.consumers.add(streamName, {
    durable_name: "scheduler",
    ack_policy: AckPolicy.Explicit,
  });

  const activeJobs = new Map<string, JobEntry>();
  const intervals = new Map<string, NodeJS.Timeout>();

  // Get the consumer and start consuming messages
  const consumer = await js.consumers.get(streamName, "scheduler");

  let messages: ConsumerMessages | null = null;

  // Start consuming messages
  const consumeMessages = async () => {
    messages = await consumer.consume();
    for await (const msg of messages) {
      try {
        const jobName = msg.subject.split('.').pop() as string;
        const jobData: JobData = JSON.parse(msg.data.toString());

        if (activeJobs.has(jobName)) {
          const { jobFn } = activeJobs.get(jobName) as JobEntry;
          // Execute the job function immediately since the message was successfully published
          await jobFn(jobData);
        }

        msg.ack();
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }
  };

  // Start consuming messages in the background
  consumeMessages().catch(err => console.error('Error consuming messages:', err));

  const addJob = async (jobFn: JobFunction, cronExpression: string, jobName: string) => {
    if (activeJobs.has(jobName)) {
      return;
    }

    activeJobs.set(jobName, { jobFn, cronExpression });

    const interval = setInterval(async () => {
      try {
        const lockSubject = `${streamName}.${jobName}`;
        const cronInstance = cronParser.parseExpression(cronExpression);
        const nextRunTime = cronInstance.next().getTime(); // Expected run time
        const msgID = `${jobName}-${nextRunTime}`; // Use expected run time for msgID

        try {
          // Try to publish with message ID to prevent duplicates
          await js.publish(lockSubject,
            JSON.stringify({
              timestamp: nextRunTime,
              instance: Math.random().toString(36).substring(7)
            }),
            { msgID }
          );
        } catch (err) {
          // Another instance already published with this ID
          return;
        }
      } catch (error) {
        console.error(`Error scheduling job ${jobName}:`, error);
      }
    }, 1000);

    intervals.set(jobName, interval);
  };

  const removeJob = async (jobName: string) => {
    const interval = intervals.get(jobName);
    if (interval) {
      clearInterval(interval);
      intervals.delete(jobName);
    }
    activeJobs.delete(jobName);
  };

  const healthCheck = async () => {
    try {
      await js.publish(`${streamName}.health`,
        JSON.stringify({ timestamp: Date.now() }),
        { msgID: `health-${Date.now()}` }
      );
      return true;
    } catch {
      return false;
    }
  };

  const shutdown = async () => {
    for (const [jobName, interval] of intervals.entries()) {
      clearInterval(interval);
      intervals.delete(jobName);
      activeJobs.delete(jobName);
    }

    await nc.close();
    await messages?.close();
  };

  return {
    addJob,
    removeJob,
    healthCheck,
    shutdown,
    activeJobs,
  };
};

export default createNatsScheduler;
