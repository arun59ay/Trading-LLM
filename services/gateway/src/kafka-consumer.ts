// services/gateway/src/kafka-consumer.ts
import { Kafka } from "kafkajs";

export async function startKafkaConsumer(io: any) {
  const broker = process.env.KAFKA_BROKER || "redpanda:9092";
  const topics = (process.env.WS_TOPICS || "signals.raw").split(",");

  const kafka = new Kafka({ brokers: [broker] });
  const consumer = kafka.consumer({ groupId: "gateway-consumer" });

  await consumer.connect();
  for (const t of topics) {
    await consumer.subscribe({ topic: t, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const value = message.value?.toString() || "";
        const payload = JSON.parse(value);
        // Forward Kafka message directly to clients
        io.emit(topic, payload);
        console.log(`📥 [Kafka → WS] ${topic}:`, payload);
      } catch (err) {
        console.error("Kafka parse error", err);
      }
    },
  });

  console.log(`✅ Kafka consumer running on ${broker}, topics: ${topics.join(", ")}`);
}
