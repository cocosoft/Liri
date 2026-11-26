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

/**
 * 内容摘要（K5.1 sha1）的**复检周期**（ms）。
 *
 * 摘要的价值是抓「内容变但 mtime 未变」（同步/还原类工具会保留时间戳）。原实现
 * 每轮对**所有**有 digest 的文件重读全文做 sha1：真机 16 个文件 38.5 MB ⇒ 42.6 ms/轮，
 * 若 digest 铺满 593 个文件将 ≈233 ms/轮（实测吞吐 1042 KB/ms）。
 *
 * 故改为两级：① 每次都用已免费的 `stat.size` 判（大小变 ⇒ 立即重编译，不读内容）；
 * ② 大小未变时只在周期到期后复读一次内容确认。代价是「同大小 + 保 mtime」的改写
 * 最迟一个周期后才被发现（普通编辑因大小变化仍是立即发现）。
 */
export const DIGEST_REVERIFY_INTERVAL_MS = 24 * 3600_000;

/**
 * 编译轮开始时**并行 stat raw 文件**的并发度（K11）。
 *
 * 真机 593 个文件：串行 13–16 ms ⇒ 并发 32 约 1.1–2.1 ms。stat 是纯读操作，
 * 并发度只影响句柄/线程瞬时占用；32 在本机实测已到拐点（再高收益 < 1ms）。
 */
export const RAW_STAT_CONCURRENCY = 32;
