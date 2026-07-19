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

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'core:external:sqlite3',
  level: LogLevel.INFO,
});

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

  constructor(
    path: string,
    mode?: number | ((err: Error | null) => void),
    openCallback?: (err: Error | null) => void
  ) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (err) {
      // 忽略

      logger.debug('Operation skipped', {
        context: '忽略',
        error: err instanceof Error ? err.message : String(err),
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
      const result = this._db.prepare(sql).run(...params);
      if (callback) {
        callback.call(
          { lastID: Number(result.lastInsertRowid), changes: result.changes },
          null
        );
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
      const row = this._db.prepare(sql).get(...this.resolveParams(args));
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
      const rows = this._db.prepare(sql).all(...this.resolveParams(args));
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
      const rows = this._db.prepare(sql).all(...this.resolveParams(args));
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
      this._db.exec(sql);
      callback?.(null);
    } catch (e) {
      callback?.(e as Error);
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
