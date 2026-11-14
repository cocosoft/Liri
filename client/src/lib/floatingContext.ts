// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 悬浮窗上下文数据（G8 内容增强，2026-11-14）
 *
 * 悬浮窗是**独立 webview**（`index.html?floating=1`），拿不到主窗口的内存 store，因此：
 * - 「当前会话 id」从**同一份持久化快照**（`STORAGE_KEYS.rootStore`）读取 —— 与主窗口同源；
 * - 「会话标题」经既有 `sessionService.list()` 取（`chatSessions` 不持久化）；
 * - 「运行中目标」经既有 `goalService.list({ activeOnly: true })` 取（会话级 `task_goals`）。
 *
 * 纯函数部分（解析 / 选标题 / 组装展示模型）可单测；`loadFloatingContext` 是唯一的 IO 入口。
 * **不做后台轮询**：调用方在挂载与窗口聚焦时刷新（另可手动刷新）。
 */

import { STORAGE_KEYS } from "@/constants/storage";
import { sessionService } from "@/services/sessionService";
import { goalService } from "@/services/goalService";
import type { TaskGoalDto } from "@/types/events";

export interface FloatingSessionInfo {
  id: string;
  /** 列表里查不到该 id ⇒ `null`（不臆造标题） */
  title: string | null;
}

export interface FloatingGoalRow {
  id: string;
  objective: string;
  tokensUsed: number;
  /** 未设预算 ⇒ `null` */
  tokenBudget: number | null;
}

export interface FloatingContext {
  session: FloatingSessionInfo | null;
  goals: FloatingGoalRow[];
  /** 读取失败（后端不可达等）⇒ 界面如实标注，不假装"没有目标" */
  unavailable: boolean;
}

export interface SessionLike {
  id: string;
  title?: string | null;
}

/** 从根 store 的 persist 快照里取 `currentSessionId`（损坏/缺字段 ⇒ `null`） */
export function readPersistedCurrentSessionId(
  raw: string | null,
): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // @ignore-catch — 损坏的持久化快照等价于"没有当前会话"，不阻断悬浮窗
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const state = (parsed as { state?: unknown }).state;
  if (typeof state !== "object" || state === null) return null;
  const value = (state as { currentSessionId?: unknown }).currentSessionId;
  return typeof value === "string" && value.trim() ? value : null;
}

/** 在会话列表里找标题（找不到 ⇒ `null`，不回落到"第一个会话"） */
export function pickSessionTitle(
  sessions: readonly SessionLike[],
  sessionId: string | null,
): string | null {
  if (!sessionId) return null;
  const found = sessions.find((s) => s.id === sessionId);
  const title = found?.title?.trim();
  return title ? title : null;
}

/** 组装展示模型（纯函数；同一输入 ⇒ 同一输出） */
export function buildFloatingContext(input: {
  currentSessionId: string | null;
  sessions: readonly SessionLike[];
  goals: readonly TaskGoalDto[];
  unavailable?: boolean;
}): FloatingContext {
  return {
    session: input.currentSessionId
      ? {
          id: input.currentSessionId,
          title: pickSessionTitle(input.sessions, input.currentSessionId),
        }
      : null,
    goals: input.goals.map((goal) => ({
      id: goal.id,
      objective: goal.objective.trim(),
      tokensUsed: goal.tokensUsed,
      tokenBudget:
        typeof goal.tokenBudget === "number" ? goal.tokenBudget : null,
    })),
    unavailable: input.unavailable === true,
  };
}

/** 读持久化快照里的当前会话 id（存储不可用 ⇒ `null`） */
export function readCurrentSessionIdFromStorage(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return readPersistedCurrentSessionId(
      localStorage.getItem(STORAGE_KEYS.rootStore),
    );
  } catch {
    // @ignore-catch — 隐私模式禁用存储 ⇒ 视为"无当前会话"
    return null;
  }
}

/**
 * 加载悬浮窗上下文（唯一 IO 入口）。
 *
 * 会话列表读取失败 ⇒ 返回 `unavailable: true`（界面如实提示"暂时读不到"），
 * 不伪造空数据为"确实没有目标"（CS04/CS06）。
 */
export async function loadFloatingContext(): Promise<FloatingContext> {
  const currentSessionId = readCurrentSessionIdFromStorage();
  try {
    const [sessions, goals] = await Promise.all([
      sessionService.list(),
      currentSessionId
        ? goalService.list({ sessionId: currentSessionId, activeOnly: true })
        : Promise.resolve<TaskGoalDto[]>([]),
    ]);
    return buildFloatingContext({ currentSessionId, sessions, goals });
  } catch {
    // @ignore-catch — 后端不可达时如实标注 unavailable（调用方据此显示"暂时读不到"）
    return buildFloatingContext({
      currentSessionId,
      sessions: [],
      goals: [],
      unavailable: true,
    });
  }
}
