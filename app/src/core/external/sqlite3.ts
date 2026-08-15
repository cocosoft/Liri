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
 * sqlite3 兼容层包装器
 *
 * 使用 Bun 内置的 bun:sqlite 模块，暴露与 sqlite3 npm 包相同的回调式 API。
 * 避免原生 C++ 插件（.node 文件）在 bun build --compile 单文件 exe 中
 * 的加载问题。
 */

import { mkdirSync } from 'fs';
import { dirname } from 'path';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('core:external:sqlite3');

/**
 * 慢查询告警阈值（毫秒）。
 * #59-2 运行期插桩：bun:sqlite 为同步 API，慢查询会直接阻塞事件循环
 * （08-13 曾观测每 ~30s 一次 500ms~25.5s 滞后，怀疑同步 DB 写/GC）。
 * 超过阈值的查询记录 SQL 摘要 + 耗时，用于归因事件循环阻塞源。
 */
const SLOW_SQL_THRESHOLD_MS = 200;

/**
 * 计时执行同步操作，超过阈值记录慢查询日志（含 SQL + 参数，便于归因阻塞源）。
 * 抛错时同样计时（慢查询失败也是阻塞归因线索）。
 */
function measure<T>(
  method: string,
  sql: string,
  fn: () => T,
  params?: unknown[]
): T {
  const startedAt = performance.now();

  /** 序列化参数（仅慢查询时调用；大对象/不可序列化时截断降级） */
  const formatParams = (): string => {
    if (!params || params.length === 0) return '';
    try {
      const text = JSON.stringify(params);
      return text.length > 300 ? `${text.slice(0, 300)}...` : text;
    } catch {
      // 参数含 BigInt/循环引用等 JSON 不可序列化值时降级为计数摘要
      return `[${params.length} params 不可序列化]`;
    }
  };

  try {
    const result = fn();
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs > SLOW_SQL_THRESHOLD_MS) {
      logger.warn(`sqlite3:慢查询 ${method} ${Math.round(elapsedMs)}ms`, {
        method,
        sql: sql.length > 500 ? `${sql.slice(0, 500)}...` : sql,
        params: formatParams(),
        elapsedMs: Math.round(elapsedMs),
      });
    }
    return result;
  } catch (e) {
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs > SLOW_SQL_THRESHOLD_MS) {
      logger.warn(`sqlite3:慢查询失败 ${method} ${Math.round(elapsedMs)}ms`, {
        method,
        sql: sql.length > 500 ? `${sql.slice(0, 500)}...` : sql,
        params: formatParams(),
        elapsedMs: Math.round(elapsedMs),
      });
    }
    throw e;
  }
}

// 使用 Bun 内置的 sqlite
const { Database: BunDB } = require('bun:sqlite') as {
  Database: new (
    path: string,
    options?: { create?: boolean; strict?: boolean }
  ) => {
    run: (
      sql: string,
      ...params: unknown[]
    ) => { changes: number; lastInsertRowid: number | bigint };
    prepare: (sql: string) => {
      get: (...params: unknown[]) => Record<string, unknown> | undefined;
      all: (...params: unknown[]) => Record<string, unknown>[];
      run: (...params: unknown[]) => {
        changes: number;
        lastInsertRowid: number | bigint;
      };
      finalize: () => void;
    };
    exec: (sql: string) => void;
    close: () => void;
    configure: (kind: string, val: boolean) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    serialize: () => void;
    parallelize: () => void;
  };
};

/**
 * 与 sqlite3 npm 包兼容的 Database 类
 * 内部使用 bun:sqlite，对外暴露相同的回调式 API
 */
class Database {
  private _db: InstanceType<typeof BunDB>;
  /** 数据库文件路径（供诊断日志使用） */
  private _path: string;

  constructor(
    path: string,
    mode?: number | ((err: Error | null) => void),
    openCallback?: (err: Error | null) => void
  ) {
    this._path = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (err) {
      // 目录创建失败时记录日志，但不阻止初始化（可能目录已存在但权限检查失败）
      // 后续 new BunDB 会自行处理路径不可用的情况
      handleError(err, {
        module: 'core:external',
        action: 'mkdirSync',
      });
    }

    let cb: ((err: Error | null) => void) | undefined;
    if (typeof mode === 'function') {
      cb = mode;
    } else if (typeof openCallback === 'function') {
      cb = openCallback;
    }

    try {
      this._db = new BunDB(path, { create: true });
      this._db.run('PRAGMA journal_mode=WAL');
      this._db.run('PRAGMA busy_timeout=10000');
      this._db.run('PRAGMA temp_store=MEMORY');
      process.nextTick(() => cb?.(null));
    } catch (e) {
      process.nextTick(() => cb?.(e as Error));
      throw e;
    }
  }

  /** 数据库是否已打开 */
  get open(): boolean {
    try {
      this._db.run('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 展开参数：兼容 sqlite3 npm 包的两种传参方式
   * 1. db.run(sql, param1, param2, ..., callback) — 独立参数
   * 2. db.run(sql, [param1, param2, ...], callback) — 数组参数
   */
  private resolveParams(args: unknown[]): unknown[] {
    if (args.length === 1 && Array.isArray(args[0])) {
      return args[0] as unknown[];
    }
    return args;
  }

  // 类型重载：让 TS 能推断回调参数类型（兼容 sqlite3 npm 包）
  run(sql: string): this;
  run(sql: string, callback: (err: Error | null) => void): this;
  run(sql: string, params: any[], callback?: (err: Error | null) => void): this;
  run(sql: string, p1: any, callback: (err: Error | null) => void): this;
  run(
    sql: string,
    p1: any,
    p2: any,
    callback: (err: Error | null) => void
  ): this;
  run(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    callback: (err: Error | null) => void
  ): this;
  run(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    p4: any,
    callback: (err: Error | null) => void
  ): this;
  run(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    p4: any,
    p5: any,
    callback: (err: Error | null) => void
  ): this;
  /** 无回调调用（5 个独立参数） */
  run(sql: string, p1: any, p2: any, p3: any, p4: any, p5: any): this;
  /**
   * 执行 SQL（无返回结果集），兼容 sqlite3 回调式 API
   */
  run(sql: string, ...args: unknown[]): this {
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (err: Error | null) => void)
        : undefined;
    try {
      const params = this.resolveParams(args);
      const result = measure(
        'run',
        sql,
        () => this._db.prepare(sql).run(...params),
        params
      );
      if (callback) {
        // W6: 安全转换 lastInsertRowid（bigint → number 可能丢失精度）
        // 超出 Number.MAX_SAFE_INTEGER 时记录警告并使用安全上限
        const lastID =
          typeof result.lastInsertRowid === 'bigint'
            ? result.lastInsertRowid > BigInt(Number.MAX_SAFE_INTEGER)
              ? (logger.warn(
                  'lastInsertRowid 超出 Number 安全范围，使用 MAX_SAFE_INTEGER',
                  {
                    value: String(result.lastInsertRowid),
                  }
                ),
                Number.MAX_SAFE_INTEGER)
              : Number(result.lastInsertRowid)
            : result.lastInsertRowid;
        callback.call({ lastID, changes: result.changes }, null);
      }
    } catch (e) {
      callback?.(e as Error);
    }
    return this;
  }

  // 类型重载：让 TS 能推断回调参数类型
  get(sql: string, callback: (err: Error | null, row: any) => void): this;
  get(
    sql: string,
    p1: any,
    callback: (err: Error | null, row: any) => void
  ): this;
  get(
    sql: string,
    p1: any,
    p2: any,
    callback: (err: Error | null, row: any) => void
  ): this;
  /**
   * 执行查询并返回单行
   */
  get(sql: string, ...args: unknown[]): this {
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (
            err: Error | null,
            row?: Record<string, unknown>
          ) => void)
        : undefined;
    try {
      const params = this.resolveParams(args);
      const row = measure(
        'get',
        sql,
        () => this._db.prepare(sql).get(...params),
        params
      );
      callback?.(null, row ?? undefined);
    } catch (e) {
      callback?.(e as Error);
    }
    return this;
  }

  // 类型重载：让 TS 能推断回调参数类型
  all(sql: string, callback: (err: Error | null, rows: any[]) => void): this;
  all(
    sql: string,
    p1: any,
    callback: (err: Error | null, rows: any[]) => void
  ): this;
  all(
    sql: string,
    p1: any,
    p2: any,
    callback: (err: Error | null, rows: any[]) => void
  ): this;
  all(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    callback: (err: Error | null, rows: any[]) => void
  ): this;
  all(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    p4: any,
    callback: (err: Error | null, rows: any[]) => void
  ): this;
  all(
    sql: string,
    p1: any,
    p2: any,
    p3: any,
    p4: any,
    p5: any,
    callback: (err: Error | null, rows: any[]) => void
  ): this;
  /**
   * 执行查询并返回所有行
   */
  all(sql: string, ...args: unknown[]): this {
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (
            err: Error | null,
            rows?: Record<string, unknown>[]
          ) => void)
        : undefined;
    try {
      const params = this.resolveParams(args);
      const rows = measure(
        'all',
        sql,
        () => this._db.prepare(sql).all(...params),
        params
      );
      callback?.(null, rows);
    } catch (e) {
      callback?.(e as Error);
    }
    return this;
  }

  // 类型重载：让 TS 能推断回调参数类型
  each(sql: string, callback: (err: Error | null, row: any) => void): this;
  each(
    sql: string,
    p1: any,
    callback: (err: Error | null, row: any) => void
  ): this;
  /**
   * 逐行迭代结果
   */
  each(sql: string, ...args: unknown[]): this {
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (
            err: Error | null,
            row?: Record<string, unknown>
          ) => void)
        : undefined;
    try {
      const params = this.resolveParams(args);
      const rows = measure(
        'each',
        sql,
        () => this._db.prepare(sql).all(...params),
        params
      );
      for (const row of rows) {
        callback?.(null, row);
      }
    } catch (e) {
      callback?.(e as Error);
    }
    return this;
  }

  /**
   * 执行多条 SQL 语句（CREATE TABLE 等），兼容 sqlite3 回调式 API
   */
  exec(sql: string, callback?: (err: Error | null) => void): this {
    try {
      measure('exec', sql, () => this._db.exec(sql));
      callback?.(null);
    } catch (e) {
      callback?.(e as Error);
    }
    return this;
  }

  /**
   * 执行 VACUUM（数据库空间回收/碎片整理）
   * 前后记录耗时与文件大小变化，供清理过程排查。
   * 注意：VACUUM 会重建整个数据库文件，大库耗时较长，执行期间独占数据库。
   */
  vacuum(callback?: (err: Error | null) => void): this {
    const startedAt = Date.now();
    logger.info('sqlite3:VACUUM 开始', {
      dbPath: this._path,
    });
    try {
      this._db.exec('VACUUM');
      const elapsedMs = Date.now() - startedAt;
      logger.info('sqlite3:VACUUM 完成', { elapsedMs });
      callback?.(null);
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn('sqlite3:VACUUM 失败', {
        elapsedMs,
        error: err.message,
      });
      void handleError(err, {
        module: 'core:external:sqlite3',
        action: 'vacuum',
      });
      callback?.(err);
    }
    return this;
  }

  /**
   * 关闭数据库连接
   */
  close(callback?: (err: Error | null) => void): void {
    try {
      this._db.close();
      callback?.(null);
    } catch (e) {
      callback?.(e as Error);
    }
  }
}

export { Database };
