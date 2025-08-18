// services/ingestor-sim/src/kafka.ts
import { Kafka } from 'kafkajs';

const brokerList =
  process.env.KAFKA_BROKERS ||
  process.env.KAFKA_BOOTSTRAP_SERVERS ||
  process.env.BROKERS ||
  'redpanda:9092';

export const kafka = new Kafka({
  clientId: 'ingestor-sim',
  brokers: brokerList.split(',').map(s => s.trim()),
});
