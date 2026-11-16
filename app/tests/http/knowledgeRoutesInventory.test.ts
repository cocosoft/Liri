// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// knowledge 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchKnowledgeRoutes` 是「顺序即语义」的路由表：知识库 bases 的写路由必须早于
// 带负向预查的通用 `/v1/knowledge/(?!bases|docs)(.+)`；回收站的精确 POST 必须早于
// `startsWith('/v1/knowledge/trash')` 的 GET/DELETE。写反不会编译失败，只会静默错配。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/knowledge-routes.ts',
    import.meta.url
  ),
  'utf8'
);

const at = (handler: string) => ROUTES.indexOf(`await ${handler}(`);
const countCalls = (handler: string) =>
  ROUTES.split(`await ${handler}(`).length - 1;

/** 各分段 handler（文件内顺序与匹配顺序一致） */
const GROUPS: ReadonlyArray<readonly string[]> = [
  [
    'handleOrchestrationStream',
    'handleGetOrchestrationHistory',
    'handleGetOrchestrationSnapshot',
    'handleGetSwarmStatus',
    'handleGetAgentModelBindings',
    'handleUpdateAgentModelBindings',
  ],
  [
    'handleListKnowledge',
    'handleGetKnowledgeDoc',
    'handleKnowledgeRawPreview',
    'handleSearchKnowledge',
    'handleCreateKnowledge',
    'handleListKnowledgeBases',
    'handleCreateKnowledgeBase',
    'handleUpdateKnowledgeBase',
    'handleDeleteKnowledgeBase',
    'handleCloneKnowledgeBase',
    'handleDuplicateKnowledgeBase',
  ],
  [
    'handleSaveFromChat',
    'handleKnowledgeUpload',
    'handleKnowledgeCompile',
    'handleKnowledgeCompileStatus',
    'handleKnowledgeLineage',
    'handleGetRawFiles',
    'handleKnowledgeHealth',
    'handleGetKnowledgeConfig',
    'handleUpdateKnowledgeConfig',
    'handleListDataSources',
    'handleCreateDataSource',
    'handleDeleteDataSource',
    'handleSyncDataSource',
    'handleListGraphEdges',
    'handleGraphStats',
  ],
  [
    'handleListSnapshots',
    'handleRestoreSnapshot',
    'handleTrashKnowledge',
    'handleRestoreTrash',
    'handleListKnowledgeTrash',
    'handlePurgeKnowledgeTrash',
    'handleExportKnowledge',
    'handleUpdateKnowledgeDoc',
    'handleExportToNotebook',
    'handleImportFromFile',
    'handleBatchDeleteKnowledge',
    'handleBatchTagKnowledge',
  ],
  [
    'handleFAQCategories',
    'handleSearchFAQ',
    'handleListFAQ',
    'handleImportFAQ',
    'handleBatchDeleteFAQ',
    'handleCreateFAQ',
    'handleUpdateFAQ',
    'handleDeleteFAQ',
  ],
  ['handleUpdateKnowledge', 'handleDeleteKnowledge'],
  [
    'handleListTeams',
    'handleCreateTeam',
    'handleGetTeam',
    'handleUpdateTeam',
    'handleDeleteTeam',
    'handleAddTeamMember',
    'handleRemoveTeamMember',
    'handleUpdateMemberRole',
  ],
];

describe('knowledge 路由清单', () => {
  it('各 handler 调用次数与现状一致（ingest 与 import-from-file 共用同一 handler）', () => {
    for (const group of GROUPS) {
      for (const handler of group) {
        if (handler === 'handleImportFromFile') continue;
        expect(countCalls(handler)).toBe(1);
      }
    }
    // POST /v1/knowledge/ingest 与 /import-from-file 共用 handleImportFromFile
    expect(countCalls('handleImportFromFile')).toBe(2);
  });

  it('分段顺序：编排 → 知识集合 → 管道 → 快照 → FAQ → 通用 → 团队', () => {
    for (let g = 1; g < GROUPS.length; g++) {
      const prevMax = Math.max(...GROUPS[g - 1]!.map(at));
      const currMin = Math.min(...GROUPS[g]!.map(at));
      expect(prevMax).toBeGreaterThan(-1);
      expect(prevMax).toBeLessThan(currMin);
    }
  });

  it('组内顺序与匹配顺序一致', () => {
    for (const group of GROUPS) {
      const positions = group.map(at);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
      }
    }
  });

  it('回收站精确 POST 先于 startsWith 的 GET / DELETE', () => {
    const exact = ROUTES.indexOf("url === '/v1/knowledge/trash'");
    const prefix = ROUTES.indexOf("url.startsWith('/v1/knowledge/trash')");
    expect(exact).toBeGreaterThan(-1);
    expect(prefix).toBeGreaterThan(-1);
    expect(exact).toBeLessThan(prefix);
  });

  it('bases 写路由先于通用负向预查路由', () => {
    const bases = ROUTES.indexOf('/^\\/v1\\/knowledge\\/bases\\/(.+)$/');
    const generic = ROUTES.indexOf(
      '/^\\/v1\\/knowledge\\/(?!bases|docs)(.+)$/'
    );
    expect(bases).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(bases).toBeLessThan(generic);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
