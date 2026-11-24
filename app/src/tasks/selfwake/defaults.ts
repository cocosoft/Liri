// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * selfwake/defaults.ts — 自唤醒的**时长/重试**默认值单一事实源。
 *
 * 为什么单独成文件：`lint:consts` 的 B 类（裸字面量）只豁免
 * `packages/infra/src/constants/` 与任意 `defaults.ts` —— 带 `_MS` / `_LIMIT` /
 * `_TIMEOUT` / `_THRESHOLD` 后缀的阈值必须集中在此（棘轮：白名单只减不增）。
 */

/**
 * 外部条件类唤醒（`completion` / `event`）的等待上限（24h，方案 §5-2 用户裁定）。
 *
 * 它们没有 `triggerAt`，只能等外部条件；触发源缺失时**永不 due** ⇒ 修复前永久停在
 * `pending`（前端「等待中」常驻）。到期由 `WakeStore.expireStale` 收敛为 `expired`。
 */
export const WAKE_EXTERNAL_TTL_MS = 24 * 3600_000;

/** 续跑失败的最大重试次数：达到即转 `failed`（不再无限重试） */
export const MAX_FIRE_ATTEMPTS = 3;
