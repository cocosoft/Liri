// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具级**用户可配**开关（2026-11-21，browser/computer use 补齐）
 *
 * 为什么不在注册期裁剪：注册只发生一次（`ToolManager#ensureToolsLoaded`），而验收要求
 * "开启后下一轮即可见，无需重启" ⇒ 门控必须在**每轮构工具定义时**求值（本模块被
 * `buildToolDefinitions` 调用），并在执行入口再兜一次（防止并发/缓存绕过）。
 *
 * 唯一登记点：{@link TOOL_FEATURE_GATES}。未登记的工具不受影响（零行为变更）。
 * 开关解析用 `resolveOptInFeatureGate`（env > 用户设置 > false，**不读变体默认**）。
 */

import { resolveOptInFeatureGate } from '@modules/query/featureGate';
import type { FeatureFlag } from '@openliri/kernel';

/** 工具名 → 功能开关（真名与 wire 名相同：两个名字都不含冒号） */
const TOOL_FEATURE_GATES: Readonly<Record<string, FeatureFlag>> = {
  browser: 'BROWSER',
  computer_use: 'COMPUTER_USE',
};

/** 该工具受哪个开关约束（未登记 ⇒ `undefined`） */
export function resolveToolFeatureGate(
  toolName: string
): FeatureFlag | undefined {
  return TOOL_FEATURE_GATES[toolName];
}

/**
 * 该工具此刻是否可用（未登记开关的工具恒为 true）。
 *
 * 受控工具用 `resolveOptInFeatureGate`：**默认关、只认 env 或用户设置**（方案 D5），
 * 不继承构建变体的静态默认（coding 变体历史上把 BROWSER 设为 true，但当时工具被归档）。
 */
export function isToolEnabledByGate(toolName: string): boolean {
  const flag = TOOL_FEATURE_GATES[toolName];
  return flag ? resolveOptInFeatureGate(flag) : true;
}

/** 给用户/模型的可执行提示（执行入口拒绝时使用） */
export function describeToolGateDisabled(toolName: string): string {
  const flag = TOOL_FEATURE_GATES[toolName];
  if (!flag) return `工具 ${toolName} 不可用`;
  const configKey = flag === 'BROWSER' ? 'browser' : 'computerUse';
  return (
    `工具 ${toolName} 当前未启用（功能开关 ${flag} 关闭）。` +
    `开通方式：设置 → 功能开关 → 打开对应项（配置键 features.${configKey}），` +
    `或设置环境变量 FEATURE_${flag}=true；开启后下一轮对话即可见，无需重启。`
  );
}
