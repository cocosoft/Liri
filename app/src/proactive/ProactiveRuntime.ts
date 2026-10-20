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
 * G-10 P4（2026-10-19）：主动消息运行时接线（队列扫描器 + 通道投递适配器）。
 *
 * 设计真源：`dev_docs/20261019/proactive-draft.md` §8「配置与开关」。
 * - 统一由 `feature('PROACTIVE')` 控制，**2026-10-20 起默认开启**（U-01 用户裁定）；
 * - 关闭（`FEATURE_PROACTIVE=false`）时：不建表、不启动扫描器、不投递 —— 行为与接线前**完全一致**；
 * - 开启时：`ProactivePushQueue.init()` → 加载期扫描一次之后按周期扫描；
 *   投递按 `target.mode` 分流：`channel` 走 `createProactiveDeliveryAdapter()`，
 *   其余写 `notifications`（`createProactiveLocalDelivery`，P3 卡片数据源）；
 * - 退出时必须调用 `stopProactiveRuntime()`（`stopScanner()` + `close()`）。
 */
import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  ProactivePushQueue,
  type ProactiveDeliver,
} from './ProactivePushQueue';
import { createProactiveDeliveryAdapter } from './ProactiveDeliveryAdapter';
import { createProactiveLocalDelivery } from './ProactiveLocalDelivery';

const logger = getLogger('proactive:runtime');

export interface ProactiveRuntimeOptions {
  /** 显式开关（缺省读 `feature('PROACTIVE')`；测试可注入） */
  enabled?: boolean;
  /** 队列数据库路径（缺省 `resolveDbPath()`；测试可注入） */
  dbPath?: string;
}

let activeQueue: ProactivePushQueue | null = null;

/** 当前运行中的队列（未启动 / 开关关闭 ⇒ null）；供生产者入队使用 */
export function getActiveProactiveQueue(): ProactivePushQueue | null {
  return activeQueue;
}

/**
 * 组装投递路由：`channel` 目标走 `DeliveryRouter`，其余（`local`/`origin`/缺省）
 * 写 `notifications`（P3 卡片的数据源）。
 */
function createDelivery(): ProactiveDeliver {
  const channel = createProactiveDeliveryAdapter({ enabled: true });
  const local = createProactiveLocalDelivery();
  return async (payload) => {
    if (payload.target?.mode === 'channel') {
      await channel(payload);
      return;
    }
    await local(payload);
  };
}

/**
 * 启动主动消息运行时。
 *
 * @returns true = 已启动（或已在运行）；false = 开关关闭，未做任何事
 */
export async function startProactiveRuntime(
  options: ProactiveRuntimeOptions = {}
): Promise<boolean> {
  const enabled = options.enabled ?? feature('PROACTIVE');
  if (!enabled) return false;
  if (activeQueue) return true;

  const queue = new ProactivePushQueue(
    options.dbPath === undefined ? {} : { dbPath: options.dbPath }
  );
  await queue.init();
  activeQueue = queue;
  queue.startScanner(createDelivery());
  logger.info('proactive:runtime_started');
  return true;
}

/** 停止扫描器并关闭队列数据库（未启动时为空操作） */
export async function stopProactiveRuntime(): Promise<void> {
  const queue = activeQueue;
  if (!queue) return;
  activeQueue = null;
  queue.stopScanner();
  await queue.close();
  logger.info('proactive:runtime_stopped');
}
