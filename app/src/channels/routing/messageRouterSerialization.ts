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

/** 解析准入等待上限（env `SESSION_ADMISSION_WAIT_MS` 覆盖；非法/缺省 ⇒ 默认 30s） */
export function resolveAdmissionWaitMs(): number {
  const raw = configManager.env('SESSION_ADMISSION_WAIT_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : SESSION_ADMISSION_WAIT_MS;
}
