import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface DeliveryMessage {
  taskId: string;
  subject: string;
  body: string;
  format: 'text' | 'json' | 'html';
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  adapterName: string;
  timestamp: number;
  error?: string;
}

export interface DeliveryAdapter {
  readonly name: string;

  deliver(message: DeliveryMessage): Promise<DeliveryResult>;
}

export class ConsoleAdapter implements DeliveryAdapter {
  readonly name = 'console';

  async deliver(message: DeliveryMessage): Promise<DeliveryResult> {
    const output =
      message.format === 'json'
        ? JSON.stringify(message, null, 2)
        : `[${message.subject}] ${message.body}`;

    logger.info('[ConsoleAdapter] 投递', {
      taskId: message.taskId,
      subject: message.subject,
    });

    logger.info('投递', { output });

    return {
      success: true,
      adapterName: this.name,
      timestamp: Date.now(),
    };
  }
}

export class FileAdapter implements DeliveryAdapter {
  readonly name = 'file';
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir ?? './delivery-output';
  }

  async deliver(message: DeliveryMessage): Promise<DeliveryResult> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');

      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }

      const fileName = `${message.taskId}-${Date.now()}.${message.format === 'html' ? 'html' : message.format === 'json' ? 'json' : 'txt'}`;
      const filePath = path.join(this.outputDir, fileName);
      const content =
        message.format === 'json'
          ? JSON.stringify(message, null, 2)
          : message.body;

      fs.writeFileSync(filePath, content, 'utf-8');

      logger.info('[FileAdapter] 已写入文件', {
        taskId: message.taskId,
        filePath,
      });

      return {
        success: true,
        adapterName: this.name,
        timestamp: Date.now(),
      };
    } catch (e) {
      return {
        success: false,
        adapterName: this.name,
        timestamp: Date.now(),
        error: String(e),
      };
    }
  }
}

export class WebhookAdapter implements DeliveryAdapter {
  readonly name = 'webhook';
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async deliver(message: DeliveryMessage): Promise<DeliveryResult> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        return {
          success: false,
          adapterName: this.name,
          timestamp: Date.now(),
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      logger.info('[WebhookAdapter] 投递成功', {
        taskId: message.taskId,
        url: this.url,
        status: response.status,
      });

      return {
        success: true,
        adapterName: this.name,
        timestamp: Date.now(),
      };
    } catch (e) {
      return {
        success: false,
        adapterName: this.name,
        timestamp: Date.now(),
        error: String(e),
      };
    }
  }
}

export class AdapterRegistry {
  private adapters: Map<string, DeliveryAdapter> = new Map();

  register(adapter: DeliveryAdapter): void {
    this.adapters.set(adapter.name, adapter);
    logger.debug('[AdapterRegistry] 注册适配器', { name: adapter.name });
  }

  get(name: string): DeliveryAdapter | undefined {
    return this.adapters.get(name);
  }

  getAll(): DeliveryAdapter[] {
    return Array.from(this.adapters.values());
  }

  async deliverTo(
    adapterName: string,
    message: DeliveryMessage
  ): Promise<DeliveryResult> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      return {
        success: false,
        adapterName,
        timestamp: Date.now(),
        error: `适配器未注册: ${adapterName}`,
      };
    }
    return adapter.deliver(message);
  }

  async deliverToAll(message: DeliveryMessage): Promise<DeliveryResult[]> {
    return Promise.all(
      Array.from(this.adapters.values()).map((a) => a.deliver(message))
    );
  }
}

export const adapterRegistry = new AdapterRegistry();
adapterRegistry.register(new ConsoleAdapter());
