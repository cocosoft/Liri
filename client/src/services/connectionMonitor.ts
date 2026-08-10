/**
 * ConnectionMonitor — 连接 / 网络状态监测
 *
 * 记录四类关键状态事件（前端视角）：
 * 1. 网络断开（navigator offline）
 * 2. 网络恢复（navigator online）
 * 3. 后端掉线（/health 连续失败达到阈值）
 * 4. 后端恢复（/health 恢复成功）
 *
 * 日志走统一 Logger（console + localStorage logStore 持久化），
 * 供排查"断网 / 后端不可达 / 会话中断"类问题时还原时间线。
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

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let backendDown = false;
let failCount = 0;

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

function markBackendDown(): void {
  if (!backendDown) {
    backendDown = true;
    logger.warn("后端连接断开（健康检查连续失败）", {
      downAt: Date.now(),
      failCount,
    });
  }
}

function markBackendUp(): void {
  if (backendDown) {
    backendDown = false;
    logger.info("后端连接已恢复", {
      recoveredAt: Date.now(),
    });
  }
}

async function tick(): Promise<void> {
  const healthy = await checkBackendHealth();
  if (healthy) {
    failCount = 0;
    markBackendUp();
  } else {
    failCount++;
    if (failCount >= FAIL_THRESHOLD) {
      markBackendDown();
    }
  }
}

function handleOffline(): void {
  logger.warn("网络已断开（offline 事件）", {
    at: Date.now(),
    navigatorOnLine: navigator.onLine,
  });
}

function handleOnline(): void {
  logger.info("网络已恢复（online 事件）", {
    at: Date.now(),
    navigatorOnLine: navigator.onLine,
  });
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

  /** 当前后端是否处于"已掉线"状态（供其他模块查询） */
  isBackendDown(): boolean {
    return backendDown;
  },
};
