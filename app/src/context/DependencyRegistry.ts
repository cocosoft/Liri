// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * DependencyRegistry — 声明式依赖注册表（T2.1）
 *
 * 对齐论文 Algorithm 3 notify 语义。构建在 core/events/EventBus 之上
 * （key 命名空间事件 `dep:${key}`），复用其 subscribe/publish 能力，
 * 仅新增 provide/inject/withdraw 语义与 value 缓存。
 *
 * 通知 payload：{ type: 'provide' | 'withdraw', prev, next, at }
 * - provide：值变化（Object.is 不等）才通知
 * - withdraw：先通知消费者（预停用）再移除
 */

import {
  createEventBus,
  EventBus,
  EventSubscription,
} from '@modules/core/events/EventBus';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:dependencyRegistry');

export interface DepRegistry {
  /** 注册 + 通知订阅者（值变化才通知） */
  provide(key: string, value: unknown): void;
  /** 未就绪返回 undefined（等待而非报错） */
  inject<T>(key: string): T | undefined;
  /** 订阅变更（provide 值变化 / withdraw 预停用） */
  subscribe(key: string, cb: (change: DepChange) => void): () => void;
  /** 先通知消费者（预停用），再移除 */
  withdraw(key: string): void;
  /** 当前已注册的 key 数量（含 realm 命名空间内绑定） */
  size(): number;
  // ===== T3.8 realm 语义（对齐论文 §5.2.1 Algorithm 7 两级解析）=====
  // 同 key 在不同 realm 下解析不同绑定；默认（非 realm）绑定与 realm 绑定互不干扰
  provideRealm(realm: string, key: string, value: unknown): void;
  injectRealm<T>(realm: string, key: string): T | undefined;
  subscribeRealm(
    realm: string,
    key: string,
    cb: (change: DepChange) => void
  ): () => void;
  withdrawRealm(realm: string, key: string): void;
}

export type DepChangeType = 'provide' | 'withdraw';

export interface DepChange {
  type: DepChangeType;
  prev: unknown;
  next: unknown;
  at: number;
}

export interface DependencyRegistryOptions {
  /** 注入 EventBus（默认独立实例，不污染全局总线） */
  bus?: EventBus;
  /** key 数量上限（默认 10_000），超出告警 */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class DependencyRegistry implements DepRegistry {
  private values = new Map<string, unknown>();
  private bus: EventBus;
  private readonly maxKeys: number;
  private warnedKeys = new Set<string>();

  constructor(options: DependencyRegistryOptions = {}) {
    this.bus = options.bus ?? createEventBus();
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  provide(key: string, value: unknown): void {
    this.provideFor(key, key, value);
  }

  /**
   * T3.8: 在指定 realm 命名空间内提供绑定。
   * 同 key 在不同 realm 下各自独立（提供/通知互不干扰）。
   */
  provideRealm(realm: string, key: string, value: unknown): void {
    this.provideFor(this.encodeKey(realm, key), key, value);
  }

  private provideFor(encodedKey: string, key: string, value: unknown): void {
    const startTime = Date.now();
    const prev = this.values.get(encodedKey);
    // 值比较用 Object.is（避免深比较开销），未变不通知
    if (Object.is(prev, value)) {
      // 可观测性：值未变跳过（跳过次数也是统计信息）
      logger.debug('依赖提供跳过（值未变）', {
        key,
        elapsedMs: Date.now() - startTime,
      });
      return;
    }

    // 阶段①：注册表写入 + 容量检查
    const opStart = Date.now();
    this.values.set(encodedKey, value);
    this.checkSize(encodedKey);
    const opMs = Date.now() - opStart;

    // 阶段②：通知派发（订阅回调同步执行，是主要耗时来源）
    const publishStart = Date.now();
    this.bus.publish(`dep:${encodedKey}`, {
      type: 'provide',
      prev,
      next: value,
      at: Date.now(),
    } satisfies DepChange);
    const publishMs = Date.now() - publishStart;

    // 可观测性：依赖提供耗时分解（无订阅者时动态 key 变更仍可追溯）
    logger.debug('依赖提供', {
      key,
      valueType: typeof value,
      elapsedMs: Date.now() - startTime,
      opMs,
      publishMs,
    });
  }

  inject<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  /** T3.8: 从指定 realm 读取绑定（两级解析第二级：σ(realm, key)） */
  injectRealm<T>(realm: string, key: string): T | undefined {
    return this.values.get(this.encodeKey(realm, key)) as T | undefined;
  }

  subscribe(key: string, cb: (change: DepChange) => void): () => void {
    return this.subscribeFor(key, cb);
  }

  /** T3.8: 订阅指定 realm 内 key 的变更（只收本 realm 通知） */
  subscribeRealm(
    realm: string,
    key: string,
    cb: (change: DepChange) => void
  ): () => void {
    return this.subscribeFor(this.encodeKey(realm, key), cb);
  }

  private subscribeFor(
    encodedKey: string,
    cb: (change: DepChange) => void
  ): () => void {
    const sub: EventSubscription = this.bus.subscribe(
      `dep:${encodedKey}`,
      (data) => {
        cb(data as DepChange);
      }
    );
    return () => sub.unsubscribe();
  }

  withdraw(key: string): void {
    this.withdrawFor(key, key);
  }

  /** T3.8: 撤销指定 realm 内绑定（只影响本 realm，不影响同名 key 的其他 realm） */
  withdrawRealm(realm: string, key: string): void {
    this.withdrawFor(this.encodeKey(realm, key), key);
  }

  private withdrawFor(encodedKey: string, key: string): void {
    const startTime = Date.now();
    const prev = this.values.get(encodedKey);
    if (prev === undefined && !this.values.has(encodedKey)) {
      // 可观测性：key 不存在跳过（跳过次数也是统计信息）
      logger.debug('依赖撤消跳过（key 不存在）', {
        key,
        elapsedMs: Date.now() - startTime,
      });
      return;
    }

    // 阶段①：通知派发（先通知消费者预停用，订阅回调同步执行）
    const publishStart = Date.now();
    this.bus.publish(`dep:${encodedKey}`, {
      type: 'withdraw',
      prev,
      next: undefined,
      at: Date.now(),
    } satisfies DepChange);
    const publishMs = Date.now() - publishStart;

    // 阶段②：注册表移除
    const opStart = Date.now();
    this.values.delete(encodedKey);
    this.warnedKeys.delete(encodedKey);
    const opMs = Date.now() - opStart;

    // 可观测性：依赖撤消耗时分解
    logger.debug('依赖撤消', {
      key,
      elapsedMs: Date.now() - startTime,
      opMs,
      publishMs,
    });
  }

  /**
   * T3.8: realm 键编码 —— 空 realm（默认绑定）直接使用原始 key，
   * 保持向后兼容；非空 realm 用 NUL 分隔符编码（key 中不会出现 NUL）。
   */
  private encodeKey(realm: string | undefined, key: string): string {
    return realm ? `${realm}\u0000${key}` : key;
  }

  size(): number {
    return this.values.size;
  }

  /** key 数量上限告警（动态 key 空间需显式 withdraw，防无限增长） */
  private checkSize(key: string): void {
    if (this.values.size > this.maxKeys && !this.warnedKeys.has(key)) {
      this.warnedKeys.add(key);
      logger.warn('DependencyRegistry key 数量超限', {
        size: this.values.size,
        maxKeys: this.maxKeys,
        key,
      });
    }
  }
}

/** 全局单例 */
export const dependencyRegistry = new DependencyRegistry();
