// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `runtime/` 模块内的数值默认值（单位：毫秒）。
 *
 * 为什么单独成文件：`scripts/lint-consts.ts` 的 D-2 裸字面量口径要求
 * `const X_MS = <数字>` 只能出现在 `packages/infra/src/constants/` 或任意 `defaults.ts`
 * —— 放在这里既符合门禁，也避免把模块级默认值塞进共享 constants。
 */

/**
 * P0-3（2026-11-05）：审批通过后触发「自动续跑」前，等待原回合结束的上界。
 *
 * 实测事故里原回合在批准后约 29s 才结束（与互斥 30s 同额会踩线）⇒ 取 120s。
 */
export const APPROVAL_RESUME_IDLE_WAIT_MS = 120_000;

/** P0-3：等待期间轮询 `isSessionStreaming` 的间隔。 */
export const APPROVAL_RESUME_IDLE_POLL_MS = 500;
