// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 防回归：测试进程的**默认数据目录**不得落在真实用户目录（2026-11-20）。
 *
 * **背景**：单测曾长期经进程级单例（`getTaskGoalStore` / `sharedTaskStore` / `inboxManager` /
 * `GoalMetricsService` …）把行写进真实 `~/.pyapp/data/app.db` —— 全量套件实测 9 张表增长
 * （`usage_records` / `goal_metrics` / `task_goals` / `taor_checkpoints` / `inbox_items` /
 * `approval_audit_log` / `review_samples` / `file_files_fts_*`），并因目标续接反复执行
 * 测试目标而污染真机。根治手段是 `app/tests/setupIsolateDataDir.ts`（由
 * `app/bunfig.toml` 的 `[test].preload` 加载，把 `LIRI_HOME` 指到临时目录）。
 *
 * **本用例守护的是"接线"本身**：preload 被删/改名/提前被覆盖时，默认解析会立刻指回真实目录
 * —— 这里断言它不在真实 `~/.pyapp` 之下。真实库是否存在与 CI 无关（只看**路径解析**）。
 *
 * 说明：`resolveDataDir()` 可能被其他用例设为各自的临时目录（env `LIRI_DATA_DIR` 或
 * `setUserDataDirOverride()`），只要不在真实用户目录内即视为隔离成立。
 */
import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isPathWithin,
  resolveDataDir,
  resolveDbPath,
  resolvePyappHome,
} from '@openliri/infra/environment';

const REAL_HOME = join(homedir(), '.pyapp');

describe('测试隔离接线（preload → 临时数据目录）', () => {
  it('LIRI_HOME 已被 preload 设定', () => {
    expect(process.env.LIRI_HOME?.trim()).toBeTruthy();
  });

  it('用户级根与数据目录、DB 路径都不在真实 ~/.pyapp 之下', () => {
    expect(isPathWithin(REAL_HOME, resolvePyappHome())).toBe(false);
    expect(isPathWithin(REAL_HOME, resolveDataDir())).toBe(false);
    expect(isPathWithin(REAL_HOME, resolveDbPath())).toBe(false);
  });
});
