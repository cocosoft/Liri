/**
 * 消息总线
 */
import { Message } from '../SubAgentCommunicator';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('subagent:messageBus');

/**
 * 消息订阅者
 */
interface Subscriber {
  id: string;
  callback: (message: Message) => void;
  filter?: (message: Message) => boolean;
}

/**
 * 消息总线
 */
export class MessageBus {
  private subscribers: Map<string, Subscriber[]> = new Map();
  private messageQueue: Message[] = [];
  private isProcessing: boolean = false;

  /**
   * 订阅消息
   * @param topic 主题
   * @param subscriberId 订阅者ID
   * @param callback 回调函数
   * @param filter 过滤函数
   */
  subscribe(
    topic: string,
    subscriberId: string,
    callback: (message: Message) => void,
    filter?: (message: Message) => boolean
  ): void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }

    const subscribers = this.subscribers.get(topic);
    if (subscribers) {
      // 检查是否已经订阅
      const existingSubscriber = subscribers.find((s) => s.id === subscriberId);
      if (!existingSubscriber) {
        subscribers.push({ id: subscriberId, callback, filter });
        logger.info(`Subscriber ${subscriberId} subscribed to topic ${topic}`);
      }
    }
  }

  /**
   * 取消订阅
   * @param topic 主题
   * @param subscriberId 订阅者ID
   */
  unsubscribe(topic: string, subscriberId: string): void {
    const subscribers = this.subscribers.get(topic);
    if (subscribers) {
      const index = subscribers.findIndex((s) => s.id === subscriberId);
      if (index !== -1) {
        subscribers.splice(index, 1);
        logger.info(
          `Subscriber ${subscriberId} unsubscribed from topic ${topic}`
        );

        // 如果没有订阅者，删除主题
        if (subscribers.length === 0) {
          this.subscribers.delete(topic);
        }
      }
    }
  }

  /**
   * 发布消息
   * @param topic 主题
   * @param message 消息
   */
  publish(topic: string, message: Message): void {
    // 添加消息到队列
    this.messageQueue.push({ ...message, topic });

    // 处理消息队列
    this.processMessageQueue();
  }

  /**
   * 处理消息队列
   */
  private processMessageQueue(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && message.topic) {
        this.processMessage(message.topic, message);
      }
    }

    this.isProcessing = false;
  }

  /**
   * 处理消息
   * @param topic 主题
   * @param message 消息
   */
  private processMessage(topic: string, message: Message): void {
    const subscribers = this.subscribers.get(topic);
    if (subscribers) {
      for (const subscriber of subscribers) {
        // 检查过滤条件
        if (!subscriber.filter || subscriber.filter(message)) {
          try {
            subscriber.callback(message);
          } catch (error) {
            logger.error(
              `Error processing message for subscriber ${subscriber.id}:`,
              { error }
            );
          }
        }
      }
    }

    // 处理通配符主题
    this.processWildcardTopics(topic, message);
  }

  /**
   * 处理通配符主题
   * @param topic 主题
   * @param message 消息
   */
  private processWildcardTopics(topic: string, message: Message): void {
    const wildcardTopics = Array.from(this.subscribers.keys()).filter((t) =>
      t.includes('*')
    );

    for (const wildcardTopic of wildcardTopics) {
      if (this.matchesWildcard(topic, wildcardTopic)) {
        const subscribers = this.subscribers.get(wildcardTopic);
        if (subscribers) {
          for (const subscriber of subscribers) {
            // 检查过滤条件
            if (!subscriber.filter || subscriber.filter(message)) {
              try {
                subscriber.callback(message);
              } catch (error) {
                logger.error(
                  `Error processing message for subscriber ${subscriber.id}:`,
                  { error }
                );
              }
            }
          }
        }
      }
    }
  }

  /**
   * 检查主题是否匹配通配符
   * @param topic 主题
   * @param wildcardTopic 通配符主题
   * @returns 是否匹配
   */
  private matchesWildcard(topic: string, wildcardTopic: string): boolean {
    // 残留 13 修复（2026-08-27）：先转义正则特殊字符再展开通配符
    const escaped = wildcardTopic
      .replace(/\\/g, '\\\\')
      .replace(/\./g, '\\.')
      .replace(/\+/g, '\\+')
      .replace(/\?/g, '\\?')
      .replace(/\^/g, '\\^')
      .replace(/\$/g, '\\$')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\|/g, '\\|')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(topic);
  }

  /**
   * 获取主题的订阅者数量
   * @param topic 主题
   * @returns 订阅者数量
   */
  getSubscriberCount(topic: string): number {
    const subscribers = this.subscribers.get(topic);
    return subscribers ? subscribers.length : 0;
  }

  /**
   * 获取所有主题
   * @returns 主题数组
   */
  getTopics(): string[] {
    return Array.from(this.subscribers.keys());
  }

  /**
   * 清理所有订阅
   */
  cleanup(): void {
    this.subscribers.clear();
    this.messageQueue = [];
    logger.info('MessageBus cleaned up');
  }
}

/**
 * 创建消息总线
 * @returns 消息总线实例
 */
export function createMessageBus(): MessageBus {
  return new MessageBus();
}
