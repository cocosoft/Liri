/**
 * ConnectionMonitor — 连接 / 网络状态监测（§十 阶段 C Connection 域）
 *
 * 以轻量状态机表达前端连接状态（connected / disconnected / reconnecting / offline），
 * 替换手写布尔 `backendDown`：
 * 1. 网络断开（navigator offline）→ OFFLINE
 * 2. 网络恢复（navigator online）→ 回 CONNECTED（若后端健康）
 * 3. 后端掉线（/health 连续失败达到阈值）→ DISCONNECTED
 * 4. 后端恢复（/health 恢复成功）→ CONNECTED
 *
 * 每次转移记录历史 + 日志分级（进入关键状态 warn，恢复 info），
 * 供排查"断网 / 后端不可达 / 会话中断"类问题时还原时间线。
 *
 * 注意：Connection 为前端本地状态机，无法注册到后端 StateMachineRegistry
 * （跨进程），故不满足 R09-002 的 Registry 注册——前端范式，状态仅本模块可见。
 */

import { createLogger } from "../utils/logger";
import { getBackendBaseUrl } from "./backendUrl";

const logger = createLogger("services:connection-monitor");

/** 健康检查间隔 */
const HEALTH_INTERVAL_MS = 10_000;
/** 连续失败达到该次数才判定"后端掉线"（防抖动） */
const FAIL_THRESHOLD = 3;
/** 单次健康检查超时 */
const HEALTH_TIMEOUT_MS = 5_000;
/** 历史记录上限 */
const MAX_HISTORY = 20;

/** 连接状态（前端本地状态机） */
export enum ConnectionState {
  /** 后端可达 */
  CONNECTED = "connected",
  /** 后端连续健康检查失败，判定掉线 */
  DISCONNECTED = "disconnected",
  /** 后端掉线后正在尝试恢复（本实现由下一次健康检查驱动，不单独建模） */
  RECONNECTING = "reconnecting",
  /** 浏览器 offline（网络断开） */
  OFFLINE = "offline",
}

/** 状态转移记录 */
export interface ConnectionTransition {
  from: ConnectionState;
  to: ConnectionState;
  reason: string;
  timestamp: number;
}

/** 关键状态：进入这些状态时日志 ≥ warn */
const CRITICAL_STATES: ReadonlySet<ConnectionState> = new Set([
  ConnectionState.DISCONNECTED,
  ConnectionState.OFFLINE,
]);

/**
 * 状态转移规则表
 * - 网络状态（OFFLINE）优先：offline 事件可来自任何状态，online 后回 CONNECTED
 * - 后端状态（CONNECTED ↔ DISCONNECTED）：健康检查驱动
 * - RECONNECTING 为预留恢复态（当前由健康检查直接跳回 CONNECTED）
 */
const TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  [ConnectionState.CONNECTED]: [
    ConnectionState.DISCONNECTED,
    ConnectionState.OFFLINE,
  ],
  [ConnectionState.DISCONNECTED]: [
    ConnectionState.CONNECTED,
    ConnectionState.RECONNECTING,
    ConnectionState.OFFLINE,
  ],
  [ConnectionState.RECONNECTING]: [
    ConnectionState.CONNECTED,
    ConnectionState.DISCONNECTED,
    ConnectionState.OFFLINE,
  ],
  [ConnectionState.OFFLINE]: [
    ConnectionState.CONNECTED,
    ConnectionState.DISCONNECTED,
    ConnectionState.RECONNECTING,
  ],
};

/**
 * 校验状态转移合法性（纯函数，供单元测试直接验证规则表）
 * 自反（from === to）视为无操作，返回 true（与 transition() 行为一致）。
 */
export function isAllowedConnectionTransition(
  from: ConnectionState,
  to: ConnectionState,
): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let failCount = 0;
let currentState = ConnectionState.CONNECTED;
let history: ConnectionTransition[] = [];

/** 记录一次状态转移（校验合法性；非法转移仅 warn 不抛错） */
function transition(to: ConnectionState, reason: string): void {
  const from = currentState;
  if (from === to) return;
  if (!isAllowedConnectionTransition(from, to)) {
    logger.warn("连接状态非法转移（忽略）", { from, to, reason });
    return;
  }

  currentState = to;
  const record: ConnectionTransition = {
    from,
    to,
    reason,
    timestamp: Date.now(),
  };
  history = [...history, record].slice(-MAX_HISTORY);

  if (CRITICAL_STATES.has(to)) {
    logger.warn(`连接状态(关键): ${from} → ${to}`, { reason });
  } else {
    logger.info(`连接状态: ${from} → ${to}`, { reason });
  }
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tick(): Promise<void> {
  const healthy = await checkBackendHealth();
  if (healthy) {
    failCount = 0;
    // 网络在线 + 后端恢复 → CONNECTED
    if (currentState !== ConnectionState.CONNECTED && navigator.onLine) {
      transition(ConnectionState.CONNECTED, "后端健康检查恢复");
    }
  } else {
    failCount++;
    if (failCount >= FAIL_THRESHOLD) {
      transition(ConnectionState.DISCONNECTED, "健康检查连续失败");
    }
  }
}

function handleOffline(): void {
  transition(ConnectionState.OFFLINE, "浏览器 offline 事件");
}

function handleOnline(): void {
  // 网络恢复：立即探测一次后端，按结果回 CONNECTED 或 DISCONNECTED
  void (async () => {
    const healthy = await checkBackendHealth();
    transition(
      healthy ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED,
      "浏览器 online 事件" + (healthy ? "（后端可达）" : "（后端仍不可达）"),
    );
  })();
}

export const connectionMonitor = {
  /** 启动监测（幂等）：监听网络事件 + 周期健康检查 */
  start(): void {
    if (started) return;
    started = true;
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    void tick();
    timer = setInterval(() => void tick(), HEALTH_INTERVAL_MS);
  },

  /** 停止监测 */
  stop(): void {
    if (!started) return;
    started = false;
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },

  /** 当前后端是否处于"已掉线"状态（兼容旧接口） */
  isBackendDown(): boolean {
    return currentState === ConnectionState.DISCONNECTED;
  },

  /** 当前连接状态 */
  getState(): ConnectionState {
    return currentState;
  },

  /** 状态转移历史（不可变快照） */
  getHistory(): ConnectionTransition[] {
    return [...history];
  },
};
