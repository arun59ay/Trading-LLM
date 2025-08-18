import { Kafka, logLevel, Admin, Consumer, Producer } from 'kafkajs';

const broker = process.env.KAFKA_BROKER || 'localhost:9092';
const kafka = new Kafka({ clientId: 'gateway', brokers: [broker], logLevel: logLevel.NOTHING });

export const admin: Admin = kafka.admin();
export const consumer: Consumer = kafka.consumer({ groupId: 'gateway-ws' });
export const producer: Producer = kafka.producer();

export async function ensureTopics(topics: string[]) {
  await admin.connect();
  const existing = await admin.listTopics();
  const missing = topics.filter(t => !existing.includes(t));
  if (missing.length) {
    await admin.createTopics({ topics: missing.map(t => ({ topic: t, numPartitions: 1, replicationFactor: 1 })) });
  }
  await admin.disconnect();
}
