/**
 * 资源池管理系统
 * 提供对象池和连接池功能，避免频繁创建和销毁资源
 */

/**
 * 资源池选项
 */
export interface ResourcePoolOptions<T> {
  /**
   * 最大资源数量
   */
  maxSize: number;

  /**
   * 最小资源数量
   */
  minSize?: number;

  /**
   * 资源创建函数
   */
  create: () => T | Promise<T>;

  /**
   * 资源销毁函数
   */
  destroy: (resource: T) => void | Promise<void>;

  /**
   * 资源验证函数
   */
  validate?: (resource: T) => boolean | Promise<boolean>;

  /**
   * 资源空闲时间（毫秒）
   */
  idleTimeout?: number;

  /**
   * 检查间隔（毫秒）
   */
  checkInterval?: number;

  /**
   * 资源重置函数
   */
  reset?: (resource: T) => void;
}

/**
 * 资源项
 */
export interface ResourceItem<T> {
  /**
   * 资源实例
   */
  resource: T;

  /**
   * 创建时间
   */
  createdAt: number;

  /**
   * 最后使用时间
   */
  lastUsedAt: number;

  /**
   * 是否正在使用
   */
  inUse: boolean;
}

/**
 * 资源池
 */
export class ResourcePool<T> {
  private options: ResourcePoolOptions<T>;
  private resources: ResourceItem<T>[] = [];
  private waitingQueue: ((resource: T) => void)[] = [];
  private checkTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(options: ResourcePoolOptions<T>) {
    this.options = {
      minSize: 0,
      idleTimeout: 30000, // 30秒
      checkInterval: 10000, // 10秒
      ...options,
    };
  }

  /**
   * 初始化资源池
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 预创建最小数量的资源
    for (let i = 0; i < this.options.minSize!; i++) {
      await this.createResource();
    }

    // 启动资源检查
    this.startResourceCheck();
    this.isInitialized = true;
  }

  /**
   * 获取资源
   */
  async acquire(): Promise<T> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // 尝试从空闲资源中获取
    const idleResource = this.resources.find((r) => !r.inUse);
    if (idleResource) {
      // 验证资源是否有效
      const isValid = await this.validateResource(idleResource.resource);
      if (isValid) {
        idleResource.inUse = true;
        idleResource.lastUsedAt = Date.now();
        return idleResource.resource;
      } else {
        // 资源无效，销毁并移除
        await this.destroyResource(idleResource);
        return this.acquire();
      }
    }

    // 检查是否达到最大资源数
    if (this.resources.length < this.options.maxSize) {
      // 创建新资源
      const resource = await this.createResource();
      const resourceItem = this.resources[this.resources.length - 1];
      resourceItem.inUse = true;
      resourceItem.lastUsedAt = Date.now();
      return resource;
    }

    // 资源池已满，加入等待队列
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  /**
   * 释放资源
   */
  async release(resource: T): Promise<void> {
    const resourceItem = this.resources.find((r) => r.resource === resource);
    if (resourceItem) {
      resourceItem.inUse = false;
      resourceItem.lastUsedAt = Date.now();

      // 通知等待队列
      if (this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift()!;
        resourceItem.inUse = true;
        resourceItem.lastUsedAt = Date.now();
        resolve(resource);
      }
    }
  }

  /**
   * 销毁资源
   */
  async destroy(resource: T): Promise<void> {
    const resourceItem = this.resources.find((r) => r.resource === resource);
    if (resourceItem) {
      await this.destroyResource(resourceItem);
    }
  }

  /**
   * 关闭资源池
   */
  async close(): Promise<void> {
    // 停止资源检查
    this.stopResourceCheck();

    // 销毁所有资源
    for (const resourceItem of this.resources) {
      await this.destroyResource(resourceItem);
    }

    this.resources = [];
    this.waitingQueue = [];
    this.isInitialized = false;
  }

  /**
   * 获取资源池状态
   */
  getStatus() {
    const total = this.resources.length;
    const inUse = this.resources.filter((r) => r.inUse).length;
    const idle = total - inUse;

    return {
      total,
      inUse,
      idle,
      waiting: this.waitingQueue.length,
      maxSize: this.options.maxSize,
      minSize: this.options.minSize,
    };
  }

  /**
   * 创建资源
   */
  private async createResource(): Promise<T> {
    const resource = await this.options.create();
    this.resources.push({
      resource,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: false,
    });
    return resource;
  }

  /**
   * 销毁资源项
   */
  private async destroyResource(resourceItem: ResourceItem<T>): Promise<void> {
    await this.options.destroy(resourceItem.resource);
    const index = this.resources.indexOf(resourceItem);
    if (index > -1) {
      this.resources.splice(index, 1);
    }
  }

  /**
   * 验证资源
   */
  private async validateResource(resource: T): Promise<boolean> {
    if (this.options.validate) {
      return await this.options.validate(resource);
    }
    return true;
  }

  /**
   * 开始资源检查
   */
  private startResourceCheck(): void {
    this.checkTimer = setInterval(() => {
      this.checkResources();
    }, this.options.checkInterval!);
  }

  /**
   * 停止资源检查
   */
  private stopResourceCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * 检查资源
   */
  private async checkResources(): Promise<void> {
    const now = Date.now();
    const idleResources = this.resources.filter((r) => !r.inUse);

    // 清理过期的空闲资源
    for (const resourceItem of idleResources) {
      if (now - resourceItem.lastUsedAt > this.options.idleTimeout!) {
        // 保留最小数量的资源
        if (this.resources.length > this.options.minSize!) {
          await this.destroyResource(resourceItem);
        }
      }
    }
  }
}

/**
 * 对象池选项
 */
export interface ObjectPoolOptions<T> {
  /**
   * 最大对象数量
   */
  maxSize: number;

  /**
   * 最小对象数量
   */
  minSize?: number;

  /**
   * 对象创建函数
   */
  create: () => T;

  /**
   * 对象重置函数
   */
  reset?: (obj: T) => void;

  /**
   * 对象验证函数
   */
  validate?: (obj: T) => boolean;

  /**
   * 对象空闲时间（毫秒）
   */
  idleTimeout?: number;

  /**
   * 检查间隔（毫秒）
   */
  checkInterval?: number;
}

/**
 * 对象池
 */
export class ObjectPool<T> extends ResourcePool<T> {
  private poolOptions: ObjectPoolOptions<T>;

  constructor(options: ObjectPoolOptions<T>) {
    super({
      maxSize: options.maxSize,
      minSize: options.minSize,
      create: options.create,
      destroy: () => {}, // 对象池不需要销毁对象
      validate: options.validate,
      idleTimeout: options.idleTimeout,
      checkInterval: options.checkInterval,
      reset: options.reset,
    });
    this.poolOptions = options;
  }

  /**
   * 释放对象
   */
  async release(obj: T): Promise<void> {
    if (this.poolOptions.reset) {
      this.poolOptions.reset(obj);
    }
    await super.release(obj);
  }
}

/**
 * 连接池选项
 */
export interface ConnectionPoolOptions<T> {
  /**
   * 最大连接数
   */
  maxSize: number;

  /**
   * 最小连接数
   */
  minSize?: number;

  /**
   * 连接创建函数
   */
  create: () => Promise<T>;

  /**
   * 连接关闭函数
   */
  close: (connection: T) => Promise<void>;

  /**
   * 连接验证函数
   */
  validate: (connection: T) => Promise<boolean>;

  /**
   * 连接空闲时间（毫秒）
   */
  idleTimeout?: number;

  /**
   * 检查间隔（毫秒）
   */
  checkInterval?: number;
}

/**
 * 连接池
 */
export class ConnectionPool<T> extends ResourcePool<T> {
  constructor(options: ConnectionPoolOptions<T>) {
    super({
      maxSize: options.maxSize,
      minSize: options.minSize,
      create: options.create,
      destroy: options.close,
      validate: options.validate,
      idleTimeout: options.idleTimeout,
      checkInterval: options.checkInterval,
    });
  }
}

/**
 * 创建对象池
 */
export function createObjectPool<T>(
  options: ObjectPoolOptions<T>
): ObjectPool<T> {
  return new ObjectPool<T>(options);
}

/**
 * 创建连接池
 */
export function createConnectionPool<T>(
  options: ConnectionPoolOptions<T>
): ConnectionPool<T> {
  return new ConnectionPool<T>(options);
}
