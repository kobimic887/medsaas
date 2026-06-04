import { createRequire } from "node:module";

const requireFromServer = createRequire(new URL("../server/package.json", import.meta.url));
const amqp = requireFromServer("amqplib");

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672/";
const queueName = process.env.RABBITMQ_SPIKE_QUEUE || "bun_spike_queue";
const timeoutMs = Number(process.env.RABBITMQ_SPIKE_TIMEOUT_MS || 10_000);
const payload = JSON.stringify({
  ping: Date.now(),
  runtime: "bun",
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let connection;
let channel;

try {
  connection = await amqp.connect(rabbitUrl);
  channel = await connection.createChannel();

  await channel.assertQueue(queueName, { durable: true });
  await channel.purgeQueue(queueName);

  const published = channel.sendToQueue(queueName, Buffer.from(payload), {
    persistent: true,
    contentType: "application/json",
  });

  if (!published) {
    throw new Error("RabbitMQ sendToQueue returned false");
  }

  const consumed = await withTimeout(
    new Promise<string>((resolve, reject) => {
      channel.consume(
        queueName,
        (message) => {
          if (!message) {
            reject(new Error("Consumer received a null message"));
            return;
          }

          const body = message.content.toString("utf8");
          channel.ack(message);
          resolve(body);
        },
        { noAck: false },
      ).catch(reject);
    }),
    timeoutMs,
  );

  if (consumed !== payload) {
    throw new Error(`Round-trip payload mismatch: expected ${payload}, got ${consumed}`);
  }

  console.log(`RabbitMQ round-tripped payload: ${consumed}`);
  await channel.deleteQueue(queueName);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid frame/i.test(message)) {
    console.error(`CAPTURED FINDING: amqplib Invalid frame error under Bun: ${message}`);
  } else {
    console.error(`RabbitMQ Bun spike failed: ${message}`);
  }
  process.exitCode = 1;
} finally {
  try {
    if (channel) {
      await channel.close();
    }
  } catch {
    // Connection close may already have closed the channel after failures.
  }

  try {
    if (connection) {
      await connection.close();
    }
  } catch {
    // Nothing else to clean up.
  }
}
