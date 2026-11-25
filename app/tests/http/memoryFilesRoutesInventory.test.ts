// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// memory-files 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchMemoryFilesRoutes` 是「顺序即语义」的路由表：`/v1/memory/dream/cycles` 精确匹配
// 必须先于周期详情正则、且都在 PUT/DELETE 泛匹配之前，否则会被 `(.+)` 吞掉。
// 写反不会编译失败，只会静默错配。本表用「handler 调用次数 + 源码内调用顺序」钉住外移等价性。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/memory-files-routes.ts',
    import.meta.url
  ),
  'utf8'
);

const countCalls = (handler: string) =>
  ROUTES.split(`await ${handler}(`).length - 1;

/** 源码内的调用顺序（与匹配顺序一一对应；重复项单列断言） */
const CALL_ORDER = [
  // Checkpoints
  'handleCreateCheckpoint',
  'handleListCheckpoints',
  'handleGetCheckpoint',
  'handleRollbackCheckpoint',
  'handleDeleteCheckpoint',
  // Memory
  'handleListMemories',
  'handleSearchMemories',
  'handleGetMemoryWeights',
  'handleGetSyncStatus',
  'handleGetStats',
  'handleGetMemorySummary',
  'handleGetMemory',
  'handleSyncMemories',
  'handleConsolidateMemories',
  'handleDreamMemories',
  'handleDreamCyclesList',
  'handleDreamCycleDetail',
  'handleDreamCycleAnalytics',
  'handleGetTeamMemoryStatus',
  'handleGetTeamConflicts',
  'handleGetTeamSyncAudit',
  'handleResolveTeamConflict',
  'handleUpdateMemory',
  'handleDeleteAllMemories',
  'handleDeleteMemory',
  // Semantic Index
  'handleBuildSemanticIndex',
  'handleGetSemanticBuildTask',
  'handleSearchSemantic',
  'handleGetSemanticIndexStatus',
  'handleClearSemanticIndex',
  // Files
  'handleFileList',
  'handleFileRead',
  'handleFileUpload',
  'handleConvertFile',
  'handleDetectFileType',
  'handleSendFileToAI',
  // Files Registry
  'handleFileHealth',
  'handleFileRegistryList',
  'handleFileRegistryDetail',
  'handleFileRegistrySearch',
  'handleFileRegistryStats',
  'handleFileRegistryDelete',
] as const;

describe('memory-files 路由清单', () => {
  it('每个 handler 恰好调用一次（POST /v1/memory 历史重复项除外）', () => {
    for (const handler of CALL_ORDER) {
      expect(countCalls(handler)).toBe(1);
    }
    // 既有重复注册保持原样（不在本次外移中"顺手"去重）
    expect(countCalls('handleCreateMemory')).toBe(2);
  });

  it('调用顺序与匹配顺序一致（顺序即语义）', () => {
    const positions = CALL_ORDER.map((h) => ROUTES.indexOf(`await ${h}(`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('梦境周期：精确列表 → 详情正则 → 分析视图（顺序不可换）', () => {
    const list = ROUTES.indexOf("url === '/v1/memory/dream/cycles'");
    const detail = ROUTES.indexOf('/dream\\/cycles\\/(dream_\\d+)$/');
    const analytics = ROUTES.indexOf(
      "url === '/v1/memory/dream/cycles/analytics'"
    );
    expect(list).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(analytics).toBeGreaterThan(-1);
    expect(list).toBeLessThan(detail);
    expect(detail).toBeLessThan(analytics);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
