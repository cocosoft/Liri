/**
 * Skills handler 路由匹配测试（v1.5 阶段 2，P1-1~P1-5 回归）
 * 验证：export/import/clone/files/system-content 等特定路由在通用 (.+)$ 之前命中专用 handler，
 * 不再被吞（404/500 根因）。
 *
 * 2026-08-09 适配：route-table 反射改直连后，dispatchRoute 直接调用 handler 函数，
 * 测试改用 spyOn 断言命中目标 handler（替代旧 self['handleX'] 反射 mock）。
 */

import { describe, it, expect, spyOn } from 'bun:test';
import { dispatchRoute } from '../../src/infrastructure/http/handlers/route-table';
import { createHandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import * as skillsHandlers from '../../src/infrastructure/http/handlers/skills-handlers';

/** 技能路由可能命中的 handler 名 */
const SKILL_HANDLERS = [
  'handleListSkills',
  'handleListSystemSkills',
  'handleExportSkills',
  'handleImportSkill',
  'handleSystemSkillFileContent',
  'handleSystemSkillContent',
  'handleSearchSkills',
  'handleRecommendedSkills',
  'handleSkillCategories',
  'handleSkillSources',
  'handleAddSkillSource',
  'handleRemoveSkillSource',
  'handleSkillFiles',
  'handleGetSkillDetail',
  'handleInstallSkill',
  'handleCloneSkill',
  'handleUninstallSkill',
  'handleUpdateSkill',
  'handleToggleSkill',
  'handleEnableSkill',
  'handleDisableSkill',
  'handleCreateSkill',
  'handleDeleteSkill',
];

type SkillHandlerKey = (typeof SKILL_HANDLERS)[number];

function makeSpies(): { spies: Record<string, ReturnType<typeof spyOn>>; calls: string[] } {
  const calls: string[] = [];
  const spies: Record<string, ReturnType<typeof spyOn>> = {};
  for (const name of SKILL_HANDLERS) {
    spies[name] = spyOn(skillsHandlers, name as keyof typeof skillsHandlers).mockImplementation(
      async () => {
        calls.push(name);
      }
    );
  }
  return { spies, calls };
}

function makeReq(method: string): {
  method: string;
  headers: Record<string, string>;
} {
  // headers 必须存在（admin 鉴权 checkAdminRequest 读取 req.headers.authorization）
  return { method, headers: {} };
}

function makeRes(): {
  writeHead: () => void;
  end: () => void;
} {
  return { writeHead: () => {}, end: () => {} };
}

describe('Skills 路由匹配（P1-1~P1-5 回归）', () => {
  const cases: Array<[string, string, string]> = [
    // 特定路由须在通用 (.+)$ 之前命中（P1-1~P1-5 修复点）
    ['GET', '/v1/skills/export', 'handleExportSkills'],
    ['POST', '/v1/skills/import', 'handleImportSkill'],
    [
      'GET',
      '/v1/skills/system/my-skill/files/content',
      'handleSystemSkillFileContent',
    ],
    ['GET', '/v1/skills/system/my-skill/content', 'handleSystemSkillContent'],
    ['GET', '/v1/skills/my-skill/files', 'handleSkillFiles'],
    ['POST', '/v1/skills/my-skill/clone', 'handleCloneSkill'],
    ['POST', '/v1/skills/my-skill/uninstall', 'handleUninstallSkill'],
    ['POST', '/v1/skills/my-skill/update', 'handleUpdateSkill'],
    ['POST', '/v1/skills/my-skill/toggle', 'handleToggleSkill'],
    ['GET', '/v1/skills/my-skill', 'handleGetSkillDetail'],
    ['GET', '/v1/skills', 'handleListSkills'],
    ['GET', '/v1/skills/system', 'handleListSystemSkills'],
    ['GET', '/v1/skills/search', 'handleSearchSkills'],
    ['GET', '/v1/skills/recommended', 'handleRecommendedSkills'],
    ['GET', '/v1/skills/categories', 'handleSkillCategories'],
    ['GET', '/v1/skills/sources', 'handleSkillSources'],
    ['POST', '/v1/skills/sources', 'handleAddSkillSource'],
    ['DELETE', '/v1/skills/sources/custom-x', 'handleRemoveSkillSource'],
  ];

  it.each(cases)('%s %s → 命中 %s', async (method: string, url: string, handler: string) => {
    const { spies, calls } = makeSpies();
    try {
      const matched = await dispatchRoute(
        makeReq(method) as never,
        makeRes() as never,
        url,
        () => {},
        createHandlerCtx()
      );
      expect(matched).toBe(true);
      expect(calls).toEqual([handler]);
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });

  it('仓库形态技能 id（含冒号/斜杠）可正确提取为参数', async () => {
    const { spies, calls } = makeSpies();
    try {
      // url 中的 : 与 / 是 path 的一部分，路由按前缀匹配（install 为精确路径）
      await dispatchRoute(
        makeReq('POST') as never,
        makeRes() as never,
        '/v1/skills/install',
        () => {},
        createHandlerCtx()
      );
      expect(calls).toEqual(['handleInstallSkill']);
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });
});
