/**
 * instanceLock.ts — 单实例锁文件（PID + 实际监听端点）
 *
 * 为什么单独成文件：
 *   ① `main.ts` 已贴近 R04-001 的 2000 行上限，锁的**格式解析**不宜再塞进去；
 *   ② 同一份格式要被三处共用（启动期的冲突检查 / HTTP 绑定后的端口发布 /
 *      退出清理），散在 main.ts 里就是三份"各解析一遍"（CS01 归一化）。
 *
 * 文件位置：`<dataDir>/.liri.lock`（`core/paths.ts` 的 `resolveDataDir`）
 *
 * 格式（v1，JSON）：
 *   {"v":1,"pid":1234,"startedAt":"2026-10-20T…","host":"127.0.0.1","port":18990}
 *
 * **兼容 legacy**：旧版本写的是**裸 PID 文本**（`String(process.pid)`）。
 * 解析时"整串是数字"按 legacy 处理 —— 只能读到 pid，读不到端点（此时客户端
 * 仍按默认端口连接）。写入统一升级为 v1。
 *
 * **端口为什么可能缺省**：锁先于 HTTP 建立（要在起服务前拦住多实例），
 * 故首次写入没有端口；HTTP 绑定成功后由 `publishInstanceEndpoint` 补写。
 * 端口缺省 ≠ 异常，消费者须容忍。
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '@modules/environment';

/** 锁文件名（位于数据目录下） */
export const INSTANCE_LOCK_FILE_NAME = '.liri.lock';

/** 锁文件格式版本 */
const INSTANCE_LOCK_VERSION = 1;

export interface InstanceLockInfo {
  /** 持有锁的进程 PID */
  pid: number;
  /** 实际监听端口（HTTP 绑定成功后才写；legacy 锁 / 尚未绑定时为 undefined） */
  port?: number;
  /** 实际监听地址（与 port 同时写入） */
  host?: string;
  /** 本实例启动时间（ISO 8601） */
  startedAt?: string;
}

/** 锁文件绝对路径 */
export function getInstanceLockPath(): string {
  return join(resolveDataDir(), INSTANCE_LOCK_FILE_NAME);
}

/**
 * 解析锁文件内容（v1 JSON 或 legacy 裸 PID）
 *
 * @returns 解析结果；空文件 / 非数字 / JSON 结构非法 ⇒ `null`
 *          （调用方按"锁内容异常，覆盖并继续"处理，不得据此判定有实例在跑）
 */
export function parseInstanceLock(raw: string): InstanceLockInfo | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof obj !== 'object' || obj === null) return null;
    const candidate = obj as Record<string, unknown>;
    const pid = candidate['pid'];
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    const port = candidate['port'];
    const host = candidate['host'];
    const startedAt = candidate['startedAt'];
    return {
      pid,
      port:
        typeof port === 'number' && Number.isInteger(port) ? port : undefined,
      host: typeof host === 'string' && host ? host : undefined,
      startedAt:
        typeof startedAt === 'string' && startedAt ? startedAt : undefined,
    };
  }

  // legacy：裸 PID 文本
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 ? { pid } : null;
}

/** 读取锁文件；不存在 / 解析失败 ⇒ `null` */
export function readInstanceLock(): InstanceLockInfo | null {
  const path = getInstanceLockPath();
  if (!existsSync(path)) return null;
  try {
    return parseInstanceLock(readFileSync(path, 'utf-8'));
  } catch {
    // @ignore-catch — 读失败等价"无锁"：调用方随后会覆盖写并继续启动
    return null;
  }
}

/** 写入锁文件（v1 格式，覆盖） */
export function writeInstanceLock(info: InstanceLockInfo): void {
  const payload: Record<string, unknown> = {
    v: INSTANCE_LOCK_VERSION,
    pid: info.pid,
    startedAt: info.startedAt ?? new Date().toISOString(),
  };
  if (typeof info.port === 'number') payload['port'] = info.port;
  if (info.host) payload['host'] = info.host;
  writeFileSync(getInstanceLockPath(), JSON.stringify(payload), 'utf-8');
}

/**
 * HTTP 绑定成功后，把**实际端口**写进实例锁
 *
 * 客户端（桌面壳 / 移动端接入说明）据此连接 —— 这是"动态端口"的可发现面。
 * 若锁文件已被其他 PID 持有（异常并发），**不覆盖**（避免把别人的端点改掉）。
 */
export function publishInstanceEndpoint(port: number, host: string): void {
  const current = readInstanceLock();
  if (current && current.pid !== process.pid) return;
  writeInstanceLock({
    pid: process.pid,
    startedAt: current?.startedAt,
    port,
    host,
  });
}

/**
 * 释放锁文件（仅当确实由当前进程持有时删除）
 *
 * 退出清理专用：异步删除不可靠（exit 事件不支持 async），故用同步 unlink。
 */
export function releaseInstanceLock(): void {
  const path = getInstanceLockPath();
  try {
    if (!existsSync(path)) return;
    const info = parseInstanceLock(readFileSync(path, 'utf-8'));
    if (info?.pid === process.pid) unlinkSync(path);
  } catch {
    // @ignore-catch — 清理失败不阻塞退出（进程终止后残留由下次启动按"异常退出"处理）
  }
}
