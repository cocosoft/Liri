/**
 * 有界UUID集合
 * 用于消息去重，基于环形缓冲区实现
 */

export class BoundedUUIDSet {
  private readonly capacity: number;
  private readonly ring: (string | undefined)[];
  private readonly set = new Set<string>();
  private writeIdx = 0;

  /**
   * 构造函数
   * @param capacity 集合容量
   */
  constructor(capacity: number) {
    this.capacity = capacity;
    this.ring = new Array<string | undefined>(capacity);
  }

  /**
   * 添加UUID
   * @param uuid UUID字符串
   */
  add(uuid: string): void {
    if (this.set.has(uuid)) return;
    
    // 移除当前写入位置的条目（如果存在）
    const evicted = this.ring[this.writeIdx];
    if (evicted !== undefined) {
      this.set.delete(evicted);
    }
    
    // 添加新UUID
    this.ring[this.writeIdx] = uuid;
    this.set.add(uuid);
    
    // 更新写入索引
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
  }

  /**
   * 检查UUID是否存在
   * @param uuid UUID字符串
   * @returns 是否存在
   */
  has(uuid: string): boolean {
    return this.set.has(uuid);
  }

  /**
   * 清空集合
   */
  clear(): void {
    this.set.clear();
    this.ring.fill(undefined);
    this.writeIdx = 0;
  }

  /**
   * 获取集合大小
   * @returns 集合大小
   */
  size(): number {
    return this.set.size;
  }

  /**
   * 获取容量
   * @returns 容量
   */
  getCapacity(): number {
    return this.capacity;
  }
}
