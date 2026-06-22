/**
 * 统一动画配置
 *
 * 集中管理所有动画定义，各组件引用此配置而非各自实现。
 * 使用说明：
 * - CSS 类名方式：直接使用 className 中的动画 class（如 animate-fade-in）
 * - 行内样式方式：从 animations 对象获取 CSSProperties
 * - Tailwind 方式：直接使用 Tailwind 内置动画（如 animate-pulse）
 */

import type { CSSProperties } from "react";

/** 动画持续时间（毫秒） */
export const DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
  blink: 800,
} as const;

/** 动画 CSS 类名字典 */
export const CLASSES = {
  /** 入场：从右滑入 */
  slideIn: "animate-slide-in",
  /** 入场：淡入 */
  fadeIn: "animate-fade-in",
  /** 消息入场：淡入 + 上滑 */
  messageEnter: "animate-message-enter",
  /** 闪烁光标（流式输出指示器） */
  streamingCursor: "streaming-cursor",
  /** 脉冲闪烁（工具执行中） */
  pulse: "animate-pulse",
} as const;

/** 行内样式动画配置 */
export const STYLES = {
  /** 闪烁光标（用于文本后闪烁的 | 符号） */
  blinkCursor: {
    animation: "streaming-blink 0.8s step-end infinite",
  } as CSSProperties,

  /** 脉冲点（用于执行中的状态指示器） */
  pulseDot: {
    animation: "pulse 1.5s ease-in-out infinite",
  } as CSSProperties,

  /** 消息入场动画 */
  messageEnter: {
    animation: "fade-in 0.2s ease-out",
  } as CSSProperties,

  /** 滑入入场动画 */
  slideEnter: {
    animation: "slide-in 0.3s ease-out",
  } as CSSProperties,
} as const;

/**
 * 获取消息入场动画的 className（支持 Tailwind + 自定义）
 * 用于 ChatMessageList 中的新消息动画
 */
export function getMessageEnterClass(isNew?: boolean): string {
  return isNew ? "animate-fade-in" : "";
}
