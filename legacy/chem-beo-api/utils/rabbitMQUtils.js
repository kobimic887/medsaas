import amqp from 'amqplib';
import { configDotenv } from 'dotenv';

// Load environment variables
configDotenv();

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    
    // RabbitMQ configuration from environment variables
    this.rabbitMQConfig = {
      url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      username: process.env.RABBITMQ_USERNAME || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
      vhost: process.env.RABBITMQ_VHOST || '/',
      admetQueue: process.env.ADMET_QUEUE_NAME || 'test_queue'
    };
    
    console.log('RabbitMQ Config:', {
      url: this.rabbitMQConfig.url,
      queue: this.rabbitMQConfig.admetQueue
    });
  }

  /**
   * Connect to RabbitMQ server
   */
  async connect() {
    try {
      if (this.isConnected) {
        return this.channel;
      }

      console.log('Connecting to RabbitMQ...');
      
      // Create connection URL with credentials
      const connectionUrl = this.rabbitMQConfig.url.includes('@') 
        ? this.rabbitMQConfig.url 
        : this.rabbitMQConfig.url.replace('://', `://${this.rabbitMQConfig.username}:${this.rabbitMQConfig.password}@`);

      this.connection = await amqp.connect(connectionUrl);
      this.channel = await this.connection.createChannel();
      
      // Setup exchange and queue
      await this.setupQueue();
      
      this.isConnected = true;
      console.log('✓ Connected to RabbitMQ successfully');
      
      // Handle connection events
      this.connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err);
        this.isConnected = false;
      });
      
      this.connection.on('close', () => {
        console.log('RabbitMQ connection closed');
        this.isConnected = false;
      });
      
      return this.channel;
    } catch (error) {
      console.error('Failed to connect to RabbitMQ:', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Setup queue for ADMET processing (equivalent to Python queue_declare)
   */
  async setupQueue() {
    try {
      // Equivalent to: queue_name = 'test_queue'
      const queue_name = this.rabbitMQConfig.admetQueue;
      
      // Try to declare queue with minimal arguments first
      try {
        // Equivalent to: channel.queue_declare(queue=queue_name, durable=True)
        await this.channel.assertQueue(queue_name, {
          durable: true
        });
        console.log(`✓ RabbitMQ queue '${queue_name}' declared successfully`);
      } catch (queueError) {
        console.log(`Queue '${queue_name}' may already exist with different parameters, trying to use existing queue...`);
        
        // If queue already exists with different parameters, try to check if it exists
        try {
          await this.channel.checkQueue(queue_name);
          console.log(`✓ Using existing RabbitMQ queue '${queue_name}'`);
        } catch (checkError) {
          // If check fails, create a queue with a unique name
          const uniqueQueueName = `${queue_name}_${Date.now()}`;
          await this.channel.assertQueue(uniqueQueueName, {
            durable: true
          });
          this.rabbitMQConfig.admetQueue = uniqueQueueName;
          console.log(`✓ Created new RabbitMQ queue '${uniqueQueueName}'`);
        }
      }
    } catch (error) {
      console.error('Failed to setup RabbitMQ queue:', error);
      throw error;
    }
  }

  /**
   * Create and send ADMET processing task to RabbitMQ
   * @param {Object} taskData - The task data containing simulation and molecule information
   */
  async createAdmetTask(taskData) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const {
        simulationKey,
        smiles,
        pdbid,
        userId,
        priority = 'normal',
        requestedAt = new Date().toISOString()
      } = taskData;

      // Validate required fields
      if (!simulationKey || !smiles) {
        throw new Error('simulationKey and smiles are required for ADMET task');
      }

      // Create task message in the specified format
      const admetTask = {
        simulation_id: simulationKey,
        smiles: [smiles]
      };

      // Equivalent to Python commands:
      // queue_name = 'test_queue'
      const queue_name = this.rabbitMQConfig.admetQueue;
      
      // channel.queue_declare(queue=queue_name, durable=True)
      // Try to declare queue, but don't fail if it already exists with different params
      try {
        await this.channel.assertQueue(queue_name, { durable: true });
      } catch (queueError) {
        console.log(`Queue '${queue_name}' already exists, continuing with message publish...`);
      }

      // Send message to queue
      const messageBody = JSON.stringify(admetTask);
      
      // Equivalent to: channel.basic_publish(
      //     exchange='',
      //     routing_key=queue_name,
      //     body='{"simulation_id": "kd7ntn5s827t", "smiles": ["c1ccc2c(c1)nc(o2)SCC(=O)O"]}',
      //     properties=pika.BasicProperties(delivery_mode=2)
      // )
      const publishResult = await this.channel.publish(
        '', // exchange='' (empty string for default exchange)
        queue_name, // routing_key=queue_name
        Buffer.from(messageBody), // body
        {
          persistent: true, // properties=pika.BasicProperties(delivery_mode=2)
          messageId: `admet_${simulationKey}_${Date.now()}`,
          timestamp: Date.now(),
          headers: {
            'task-type': 'admet_prediction',
            'simulation-id': simulationKey,
            'priority': priority
          }
        }
      );

      if (publishResult) {
        console.log('✓ ADMET task sent to RabbitMQ:', {
          simulationId: simulationKey,
          smiles: smiles,
          messageBody: admetTask
        });
        
        return {
          success: true,
          taskId: `admet_${simulationKey}_${Date.now()}`,
          message: 'ADMET processing task created successfully',
          estimatedProcessingTime: '2-5 minutes',
          queuePosition: 'pending',
          messageBody: admetTask
        };
      } else {
        throw new Error('Failed to publish message to RabbitMQ');
      }
      
    } catch (error) {
      console.error('Error creating ADMET task:', error);
      throw new Error(`Failed to create ADMET task: ${error.message}`);
    }
  }

  /**
   * Get queue status and statistics
   */
  async getQueueStatus() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const queueInfo = await this.channel.checkQueue(this.rabbitMQConfig.admetQueue);
      
      return {
        queue: this.rabbitMQConfig.admetQueue,
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount,
        status: this.isConnected ? 'connected' : 'disconnected'
      };
    } catch (error) {
      console.error('Error getting queue status:', error);
      return {
        queue: this.rabbitMQConfig.admetQueue,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Close RabbitMQ connection
   */
  async close() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      console.log('RabbitMQ connection closed');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  }

  /**
   * Health check for RabbitMQ connection
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      
      // Simple check - try to get queue info
      await this.channel.checkQueue(this.rabbitMQConfig.admetQueue);
      
      return {
        status: 'healthy',
        connected: this.isConnected,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const rabbitMQService = new RabbitMQService();

// Export functions
export const createAdmetTask = (taskData) => rabbitMQService.createAdmetTask(taskData);
export const getQueueStatus = () => rabbitMQService.getQueueStatus();
export const closeRabbitMQ = () => rabbitMQService.close();
export const rabbitMQHealthCheck = () => rabbitMQService.healthCheck();

// Export the service class for advanced usage
export { RabbitMQService };

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Closing RabbitMQ connection...');
  await rabbitMQService.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing RabbitMQ connection...');
  await rabbitMQService.close();
  process.exit(0);
});
