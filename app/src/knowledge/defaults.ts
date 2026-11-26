// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * knowledge/defaults.ts — 知识编译的**运行参数默认值（B 类）**单一事实源。
 *
 * 为什么单独成文件：`lint:consts` 的 B 类（裸字面量）只豁免
 * `packages/infra/src/constants/` 与任意 `defaults.ts` —— 带 `_MS` / `_LIMIT` /
 * `_TIMEOUT` / `_THRESHOLD` 后缀的阈值必须集中在此（棘轮：白名单只减不增）。
 */

/**
 * 编译进度 SSE 广播的最小间隔（ms）。
 *
 * 编译循环对每个 raw 文件调用一次 `updateCompileProgress`（真机 593 次/轮），
 * 逐次广播会把同等数量的事件推给前端 store 重渲染。节流只降低**广播**频率：
 * 内存里的 `current` 仍逐文件更新（`GET /v1/knowledge/compile-status` 精度不变），
 * 失败与最后一个文件仍即时广播。
 */
export const PROGRESS_BROADCAST_MIN_INTERVAL_MS = 200;
