/**
 * 声音服务——使用 Web Audio API 生成提示音
 *
 * 职责：
 * - playWarningSound()：危险操作/需要输入时播放警示音
 * - playCompletionSound()：AI 任务完成时播放提示音
 *
 * 容错：AudioContext 不可用时静默降级 audioAvailable = false，所有 play* 秒返回
 * 节流：警示音 1s 内不重复，完成音 3s 内不重复
 * 配置：从 useConfigStore 读取 inputNeededEnabled / taskCompleteEnabled
 */

import { useConfigStore } from "../stores/configStore";
import { createLogger } from "@/utils/logger";

const logger = createLogger("services:soundService");

/** AudioContext 运行环境是否可用 */
let audioAvailable = true;
let audioCtx: AudioContext | null = null;

/** 警示音节流时间戳 */
let lastWarningTime = 0;
const WARNING_THROTTLE_MS = 1000;

/** 完成音节流时间戳 */
let lastCompletionTime = 0;
const COMPLETION_THROTTLE_MS = 3000;

/**
 * 获取或创建 AudioContext（懒初始化）
 * 首次失败后永久降级 audioAvailable = false
 */
function getContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) throw new Error("AudioContext not supported");
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (e) {
    logger.warn("AudioContext 不可用，静默降级", e);
    audioAvailable = false;
    return null;
  }
}

/** 读取通知配置中的布尔开关 */
function isNotificationEnabled(key: string): boolean {
  const config = useConfigStore.getState().config;
  const notifications = config.notifications as Record<string, unknown> | undefined;
  if (notifications && typeof notifications[key] === "boolean") {
    return notifications[key] as boolean;
  }
  return true; // 默认开启
}

/**
 * 危险操作警示音
 * 方形波 800Hz，短促刺耳以引起注意
 * 节流：1 秒内不重复
 */
export function playWarningSound(): void {
  if (!audioAvailable) return;
  if (!isNotificationEnabled("inputNeededEnabled")) return;

  const now = Date.now();
  if (now - lastWarningTime < WARNING_THROTTLE_MS) return;
  lastWarningTime = now;

  const ctx = getContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.2);
}

/**
 * 任务完成提示音
 * 正弦波上行双音：A4(440Hz) → E5(660Hz)，五度音程柔和悦耳
 * 节流：3 秒内不重复
 * 行为：Tab 可见时播声音，Tab 隐藏时弹浏览器通知
 */
export function playCompletionSound(): void {
  if (!audioAvailable) return;
  if (!isNotificationEnabled("taskCompleteEnabled")) return;

  const now = Date.now();
  if (now - lastCompletionTime < COMPLETION_THROTTLE_MS) return;
  lastCompletionTime = now;

  // Tab 隐藏时：弹浏览器通知不播声音
  if (document.visibilityState !== "visible") {
    if (Notification.permission === "granted") {
      new Notification("Liri", { body: "已完成任务" });
    }
    return;
  }

  const ctx = getContext();
  if (!ctx) return;

  [440, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.15);
    osc.stop(ctx.currentTime + i * 0.15 + 0.2);
  });
}
