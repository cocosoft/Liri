// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// messageRouter 串行化 / 会话键 / 准入等待助手（自 `messageRouter.ts` **纯搬迁**，2026-10-09 C3-S3）。

import { configManager } from '@modules/config';
import { SESSION_ADMISSION_WAIT_MS } from './messageRouterContract';

/**
 * Windows 兼容：会话 ID 可能含文件系统非法字符（如 QQ 的 "c2c:{openid}"、
 * 群聊的 "group:{gid}:{uid}"），直接作为持久化目录名会导致 mkdir ENOTDIR
 * 失败（会话创建失败 → chat 报错 → 渠道无回复）。统一替换为 '_'
 * （确定性映射，同一用户/会话每次生成相同 ID，会话复用不受影响）。
 */
export function sanitizeSessionId(id: string): string {
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
}

/**
 * Per-conversation 串行队列（DEEP-6 修复）
 *
 * 同会话内多条消息按到达顺序串行处理，避免 LLM 并发导致回复乱序。
 * key = channel:conversationId（DM 下 conversationId=senderId，天然隔离）。
 *
 * ⚠️ 2026-10-19 起，入站主路径改用下方**到达序闸门**（`registerArrivalSlot`）：
 * 本队列若在多个 `await` 之后才登记，排队顺序取决于前置步骤完成耗时，而非消息到达顺序。
 * 本函数保留为通用串行工具（其他调用方/测试仍可使用）。
 */
const sessionQueues = new Map<string, Promise<void>>();

/**
 * 按会话 key 串行执行 fn
 * 前一条完成后再执行下一条，保证同会话内回复顺序与消息到达顺序一致。
 */
export async function runSerialized<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = sessionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  sessionQueues.set(key, next);
  try {
    return await prev.then(fn);
  } finally {
    release();
    // 若队列已空（当前就是队尾）则清理，防止 Map 无限增长
    if (sessionQueues.get(key) === next) {
      sessionQueues.delete(key);
    }
  }
}

/**
 * 到达序闸门（2026-10-19，DEEP-6 根因修复）
 *
 * 背景：渠道适配器（飞书/钉钉/Telegram 等）对每个事件并发调用
 * `void handleIncomingMessage()`，而 `routeChannelMessage` 在进入 LLM 前有多个
 * `await`（DM 授权读盘 / shared-context 落盘 / 审批预检动态导入）。若只在 LLM 前
 * 用 `runSerialized` 排队，**排队顺序取决于前置步骤的完成顺序**，而不是消息到达顺序
 * ⇒ 快速连发时后一条可能先启动 LLM，回复顺序与发送顺序相反。
 *
 * 方案：入口处**同步**登记到达序（`registerArrivalSlot`，调用顺序 = 到达顺序）；
 * 进入 LLM 前等待**所有更早到达**的消息处理完毕（`waitForEarlierArrivals`）；
 * 消息在任意出口结束时释放（`releaseArrivalSlot`）。
 *
 * 控制面消息（待答问题的回答 / 文本审批）在到达 LLM 前即返回，不会等待闸门 ⇒
 * 不会被"正在等待它们的长回合"死锁。
 */
export interface ArrivalSlot {
  /** 会话键（`channel:sessionKey`） */
  key: string;
  /** 本消息处理完成信号（供更晚到达的消息等待） */
  done: Promise<void>;
  resolve: () => void;
}

const arrivalSlots = new Map<string, ArrivalSlot[]>();

/** 在消息入口**同步**登记到达序；必须在任何 `await` 之前调用 */
export function registerArrivalSlot(key: string): ArrivalSlot {
  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  const slot: ArrivalSlot = { key, done, resolve };
  const list = arrivalSlots.get(key);
  if (list) list.push(slot);
  else arrivalSlots.set(key, [slot]);
  return slot;
}

/**
 * 进入 LLM 前等待同会话中**所有更早到达**的消息处理完毕。
 *
 * 只等待登记时已存在的更早槽位（`slice(0, idx)`）：更晚到达的消息由它们自己
 * 等待本槽位（`done`），不会反向阻塞。
 */
export async function waitForEarlierArrivals(slot: ArrivalSlot): Promise<void> {
  const list = arrivalSlots.get(slot.key);
  if (!list) return;
  const idx = list.indexOf(slot);
  if (idx <= 0) return;
  await Promise.all(list.slice(0, idx).map((s) => s.done));
}

/** 释放到达序（任意出口调用；幂等由调用方保证一次） */
export function releaseArrivalSlot(slot: ArrivalSlot): void {
  slot.resolve();
  const list = arrivalSlots.get(slot.key);
  if (!list) return;
  const idx = list.indexOf(slot);
  if (idx >= 0) list.splice(idx, 1);
  if (list.length === 0) arrivalSlots.delete(slot.key);
}

/** 解析准入等待上限（env `SESSION_ADMISSION_WAIT_MS` 覆盖；非法/缺省 ⇒ 默认 30s） */
export function resolveAdmissionWaitMs(): number {
  const raw = configManager.env('SESSION_ADMISSION_WAIT_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : SESSION_ADMISSION_WAIT_MS;
}
