import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  DeliveryAdapter,
  ConsoleAdapter,
  FileAdapter,
  type DeliveryMessage,
} from '../adapter/DeliveryAdapter';

const logger = new Logger({
  module: 'core:delivery:notifier:failureNotifier',
  level: LogLevel.INFO,
});

export interface FailureContext {
  taskId: string;
  error: string;
  retryCount: number;
  maxRetries: number;
  startedAt: number;
  failedAt: number;
  metadata?: Record<string, unknown>;
}

export interface NotifyChannel {
  readonly name: string;
  send(context: FailureContext): Promise<void>;
}

class ConsoleChannel implements NotifyChannel {
  readonly name = 'console';

  async send(context: FailureContext): Promise<void> {
    logger.error('[FailureNotifier] 任务失败', {
      taskId: context.taskId,
      error: context.error,
      retryCount: context.retryCount,
    });
  }
}

class FileChannel implements NotifyChannel {
  readonly name = 'file';
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir ?? './failure-logs';
  }

  async send(context: FailureContext): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const filePath = path.join(
      this.outputDir,
      `failure-${context.taskId}-${Date.now()}.json`
    );
    fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf-8');
  }
}

export class FailureNotifier {
  private channels: Map<string, NotifyChannel> = new Map();
  private adapters: DeliveryAdapter[] = [];

  constructor() {
    this.addChannel(new ConsoleChannel());
  }

  addChannel(channel: NotifyChannel): void {
    this.channels.set(channel.name, channel);
  }

  removeChannel(name: string): void {
    this.channels.delete(name);
  }

  addFileChannel(outputDir?: string): void {
    this.addChannel(new FileChannel(outputDir));
  }

  registerAdapter(adapter: DeliveryAdapter): void {
    this.adapters.push(adapter);
  }

  async notify(context: FailureContext): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.send(context);
      } catch (e) {
        await handleError(e, {
          module: 'core:delivery',
          action: 'notify_channel',
        });
      }
    }

    if (this.adapters.length > 0) {
      const message: DeliveryMessage = {
        taskId: context.taskId,
        subject: `任务失败: ${context.taskId}`,
        body: JSON.stringify(
          {
            error: context.error,
            retryCount: context.retryCount,
            maxRetries: context.maxRetries,
            duration: context.failedAt - context.startedAt,
          },
          null,
          2
        ),
        format: 'json',
        metadata: context.metadata,
      };

      for (const adapter of this.adapters) {
        try {
          await adapter.deliver(message);
        } catch (e) {
          await handleError(e, {
            module: 'core:delivery',
            action: 'deliver_adapter',
          });
        }
      }
    }
  }

  shouldRetry(context: FailureContext): boolean {
    return context.retryCount < context.maxRetries;
  }
}

export const failureNotifier = new FailureNotifier();
