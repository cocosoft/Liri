// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// config-skills 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchConfigSkillsRoutes` 是「顺序即语义」的路由表：settings 的
// data-directory / projects-directory 必须先于通用 `/v1/settings/{ns}`，
// skills 的 system / export / import / files 等具体端点必须先于通用 `(.+)`。
// 写反不会编译失败，只会静默错配（2026-11-03 的 P2 缺陷即此形态）。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/config-skills-routes.ts',
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
    'handleFavicon',
    'handleListConfig',
    'handleGetConfig',
    'handleSetConfig',
    'handleDeleteConfig',
  ],
  [
    'handleGetDataDirectory',
    'handleSetDataDirectory',
    'handleGetProjectsDirectory',
    'handleSetProjectsDirectory',
    'handleGetSettings',
    'handleSetSettings',
  ],
  ['handleRouterGetConfig', 'handleRouterUpdateConfig'],
  [
    'handleGetPermissionMetrics',
    'handleListPermissionRules',
    'handleGetPermissionRulesHealth',
    'handleSimulatePermissionRule',
    'handleExportPermissionRules',
    'handleImportPermissionRules',
    'handleAddPermissionRule',
    'handleUpdatePermissionRule',
    'handleDeletePermissionRule',
    'handleGetPermissionRbac',
    'handlePermissionRbacAction',
  ],
  [
    'handleGetSandboxConfig',
    'handleUpdateSandboxConfig',
    'handleGetSandboxStatus',
  ],
  [
    'handleListAutoReplyRules',
    'handleCreateAutoReplyRule',
    'handleUpdateAutoReplyRule',
    'handleDeleteAutoReplyRule',
  ],
  [
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
  ],
  [
    'handleSkillFiles',
    'handleGetSkillDetail',
    'handleInstallSkill',
    'handleCloneSkill',
    'handleUninstallSkill',
    'handleUpdateSkill',
    'handleToggleSkill',
    'handleCreateSkill',
    'handleUpdateSkillById',
    'handleDeleteSkill',
    'handleEnableSkill',
    'handleDisableSkill',
  ],
];

describe('config-skills 路由清单', () => {
  it('55 个 handler 各被调用一次（漏项 = 路由丢失）', () => {
    for (const group of GROUPS) {
      for (const handler of group) {
        expect(countCalls(handler)).toBe(1);
      }
    }
  });

  it('分段顺序：Config → Settings → Router → Permission → Sandbox → AutoReply → Skills 集合 → Skills 单项', () => {
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

  it('settings 具体端点先于通用命名空间（P2 修复不可回退）', () => {
    const dataDir = ROUTES.indexOf("url === '/v1/settings/data-directory'");
    // 用 `url.match(...)` 定位代码点，避免命中上方注释里引用的同一正则
    const generic = ROUTES.indexOf('url.match(/^\\/v1\\/settings\\/(.+)$/)');
    expect(dataDir).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(dataDir).toBeLessThan(generic);
  });

  it('skills 具体端点先于通用 (.+)（system / files 不被吞）', () => {
    const system = ROUTES.indexOf("url === '/v1/skills/system'");
    const filesRegex = ROUTES.indexOf('/^\\/v1\\/skills\\/(.+)\\/files$/');
    const generic = ROUTES.indexOf('/^\\/v1\\/skills\\/(.+)$/');
    expect(system).toBeGreaterThan(-1);
    expect(filesRegex).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(system).toBeLessThan(generic);
    expect(filesRegex).toBeLessThan(generic);
  });

  it('分发函数以 return false 兜底（未匹配不得吞请求）', () => {
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
