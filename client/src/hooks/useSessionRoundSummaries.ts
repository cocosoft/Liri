/**
 * `useSessionRoundSummaries` —— 会话**按轮摘要**的一次性拉取（2026-10-30，B2）。
 *
 * 为什么需要（一致性核查 §9.4 B2）：消息是**尾部分页**的，前端只能对已加载的一页算摘要
 * ——真机 26 轮会话只显示最近 9 轮，未加载轮次没有文本可显示。后端
 * `GET /v1/sessions/:id/round-summaries` 一次返回全量轮次摘要（绝对轮号），本钩子负责：
 * - **一次请求**覆盖整会话（不为每轮各发一次）；
 * - **进程内缓存**（按会话），同一会话的多个消费方（左侧导航 / 右侧消息摘要）共用，
 *   StrictMode 双挂载与两侧同时挂载都只发一次；
 * - 轮数增长（`roundCount` 变大）时重新拉取，其余情况复用缓存。
 *
 * 失败语义：返回空数组（消费方回退为"只显示已加载轮次"），不阻断会话可用性。
 */
import { useEffect, useState } from "react";

import {
  sessionService,
  type SessionRoundSummary,
} from "../services/sessionService";

/** 单次请求覆盖的最大轮数（与后端 `ROUND_SUMMARY_MAX_ROUNDS` 上限对齐前的常用档位） */
const FETCH_LIMIT = 200;

interface CacheEntry {
  /** 拉取时的会话总轮数（`roundCount`）；增长即视为需要刷新 */
  roundCount: number;
  rounds: SessionRoundSummary[];
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SessionRoundSummary[]>>();

function load(sessionId: string): Promise<SessionRoundSummary[]> {
  const existing = inflight.get(sessionId);
  if (existing) return existing;
  const p = sessionService
    .getRoundSummaries(sessionId, FETCH_LIMIT)
    .finally(() => inflight.delete(sessionId));
  inflight.set(sessionId, p);
  return p;
}

export function useSessionRoundSummaries(
  sessionId: string | undefined,
  roundCount: number = 0,
): SessionRoundSummary[] {
  const [rounds, setRounds] = useState<SessionRoundSummary[]>(() =>
    sessionId ? (cache.get(sessionId)?.rounds ?? []) : [],
  );

  useEffect(() => {
    if (!sessionId) {
      setRounds([]);
      return;
    }
    const hit = cache.get(sessionId);
    // 已覆盖当前轮数 ⇒ 直接用缓存（不重复请求）
    if (hit && hit.roundCount >= roundCount) {
      setRounds(hit.rounds);
      return;
    }
    let cancelled = false;
    void load(sessionId).then((list) => {
      if (cancelled) return;
      cache.set(sessionId, { roundCount, rounds: list });
      setRounds(list);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, roundCount]);

  return rounds;
}

/** 测试用：清空缓存（生产代码不调用） */
export function __clearSessionRoundSummariesCache(): void {
  cache.clear();
  inflight.clear();
}
