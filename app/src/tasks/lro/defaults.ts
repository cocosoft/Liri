// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * lro/defaults.ts — LRO 的**时长/阈值**默认值单一事实源。
 *
 * 为什么单独成文件：`lint:consts` 的 B 类（裸字面量）只豁免
 * `packages/infra/src/constants/` 与任意 `defaults.ts` —— 带 `_MS` / `_LIMIT` /
 * `_TIMEOUT` / `_THRESHOLD` 后缀的阈值必须集中在此（棘轮：白名单只减不增）。
 */

/** 单次模型调用超过该耗时即告警（真机 `pdca_mw7sfwyf`：规划调用实测 109s 且全程无日志） */
export const SLOW_MODEL_CALL_WARN_MS = 60_000;
