// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * config-skills-routes.ts — dispatchConfigSkillsRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleDeleteConfig,
  handleFavicon,
  handleGetConfig,
  handleGetProjectsDirectory,
  handleGetSettings,
  handleListConfig,
  handleRouterGetConfig,
  handleRouterUpdateConfig,
  handleSetConfig,
  handleSetDataDirectory,
  handleSetProjectsDirectory,
  handleSetSettings,
} from '../config-handlers';
import { handleGetDataDirectory } from '../chat-handlers';
import {
  handleAddPermissionRule,
  handleDeletePermissionRule,
  handleExportPermissionRules,
  handleGetPermissionMetrics,
  handleGetPermissionRulesHealth,
  handleImportPermissionRules,
  handleListPermissionRules,
  handleSimulatePermissionRule,
  handleUpdatePermissionRule,
} from '../permission-handlers';
import {
  handleGetPermissionRbac,
  handlePermissionRbacAction,
} from '../permission-rbac-handlers';
import {
  handleGetSandboxConfig,
  handleGetSandboxStatus,
  handleUpdateSandboxConfig,
} from '../sandbox-handlers';
import {
  handleCreateAutoReplyRule,
  handleDeleteAutoReplyRule,
  handleListAutoReplyRules,
  handleUpdateAutoReplyRule,
} from '../auto-reply-handlers';
import {
  handleAddSkillSource,
  handleCloneSkill,
  handleCreateSkill,
  handleDeleteSkill,
  handleDisableSkill,
  handleEnableSkill,
  handleExportSkills,
  handleGetSkillDetail,
  handleImportSkill,
  handleInstallSkill,
  handleListSkills,
  handleListSystemSkills,
  handleRecommendedSkills,
  handleRemoveSkillSource,
  handleSearchSkills,
  handleSkillCategories,
  handleSkillFiles,
  handleSkillSources,
  handleSystemSkillContent,
  handleSystemSkillFileContent,
  handleToggleSkill,
  handleUninstallSkill,
  handleUpdateSkill,
  handleUpdateSkillById,
} from '../skills-handlers';

/**
 * Config 域路由（favicon + `/v1/config` 读 / 写 / 删）。
 *
 * 2026-11-12：从 `dispatchConfigSkillsRoutes` **纯搬运**提炼（行为逐字不变）——
 * 该分发器圈复杂度已达 102（≥100 属"重尾离群"，而复杂度棘轮只允许减少），
 * 把这一段内聚分支独立成函数即回落到阈值以下。
 */
async function dispatchConfigRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  if (method === 'GET' && url === '/favicon.ico') {
    await handleFavicon(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/config') {
    await handleListConfig(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/config\/(.+)$/)) {
    await handleGetConfig(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/config\/(.+)$/)) {
    await handleSetConfig(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/config\/(.+)$/)) {
    await handleDeleteConfig(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/config\/(.+)$/)![1]
    );
    return true;
  }
  return false;
}

/**
 * Settings 段（P3-2，2026-11-16：由下方分发函数**原样外移**，匹配顺序不变 ——
 * 具体端点仍排在通用 `/v1/settings/{namespace}` 之前）。
 * @returns true 表示已匹配并处理
 */
async function dispatchSettingsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Settings（具体端点**必须**排在通用 `/v1/settings/{namespace}` 之前）----
  //
  // P2（2026-11-03 修正）：原先这两条排在通用分支之后 ⇒ 被 `/^\/v1\/settings\/(.+)$/`
  // 抢先匹配 ⇒ 设置页的"数据目录"读写实际落到通用 `handleGet/SetSettings`（写的是
  // `settings.data-directory` 配置键，而非 `settings.json#dataDirectory`）⇒ 保存后不生效。
  if (method === 'GET' && url === '/v1/settings/data-directory') {
    await handleGetDataDirectory(handlerCtx, req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/settings/data-directory') {
    await handleSetDataDirectory(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/settings/projects-directory') {
    await handleGetProjectsDirectory(handlerCtx, req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/settings/projects-directory') {
    await handleSetProjectsDirectory(handlerCtx, req, res);
    return true;
  }

  // 统一设置端点
  if (method === 'GET' && url.match(/^\/v1\/settings\/(.+)$/)) {
    await handleGetSettings(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/settings\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/settings\/(.+)$/)) {
    await handleSetSettings(
      handlerCtx,
      req,
      res,
      url.match(/^\/v1\/settings\/(.+)$/)![1]
    );
    return true;
  }
  return false;
}

/**
 * Router（智能路由）段（P3-2，2026-11-16：由下方分发函数**原样外移**）。
 * @returns true 表示已匹配并处理
 */
async function dispatchRouterRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Router（智能路由）----
  if (method === 'GET' && url === '/v1/router/config') {
    await handleRouterGetConfig(handlerCtx, req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/router/config') {
    await handleRouterUpdateConfig(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * Permissions（工具权限规则 + RBAC）段（P3-2，2026-11-16：由下方分发函数**原样外移**）。
 * @returns true 表示已匹配并处理
 */
async function dispatchPermissionRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Permissions（工具权限规则管理，P1-5）----
  if (method === 'GET' && url === '/v1/permissions/metrics') {
    await handleGetPermissionMetrics(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/permissions/rules') {
    await handleListPermissionRules(req, res);
    return true;
  }
  // R0（2026-11-17）：规则文件健康视图 + 只读模拟 —— 具体子路径必须先于
  // `DELETE /v1/permissions/rules/(.+)` 的通用段（否则 `health` / `simulate` 会被当成 ruleId）。
  if (method === 'GET' && url === '/v1/permissions/rules/health') {
    await handleGetPermissionRulesHealth(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/permissions/rules/simulate') {
    await handleSimulatePermissionRule(req, res);
    return true;
  }
  // R2b（2026-11-17）：规则备份 / 回灌（导出只含用户手建规则；导入先全量校验再落盘）
  if (method === 'GET' && url === '/v1/permissions/rules/export') {
    await handleExportPermissionRules(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/permissions/rules/import') {
    await handleImportPermissionRules(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/permissions/rules') {
    await handleAddPermissionRule(req, res);
    return true;
  }
  // R2（2026-11-17）：编辑规则（只允许 behavior / contentPattern；审批规则 403）
  if (method === 'PUT' && url.match(/^\/v1\/permissions\/rules\/(.+)$/)) {
    await handleUpdatePermissionRule(
      req,
      res,
      url.match(/^\/v1\/permissions\/rules\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/permissions\/rules\/(.+)$/)) {
    await handleDeletePermissionRule(
      req,
      res,
      url.match(/^\/v1\/permissions\/rules\/(.+)$/)![1]
    );
    return true;
  }
  // 2026-11-11：**撤销 P3-3 第二步**（当时摘除 D 体系 HTTP/UI 入口）。
  // CLI 已补齐 RBAC 增删绑定，前端面板需要同源数据 ⇒ 重新开放：
  // GET 快照 + POST 动作（写操作复用命令层实现；前缀受 adminWriteRoutes 管理面校验）。
  if (method === 'GET' && url === '/v1/permissions/rbac') {
    await handleGetPermissionRbac(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/permissions/rbac') {
    await handlePermissionRbacAction(req, res);
    return true;
  }
  return false;
}

/**
 * Sandbox（沙箱配置与状态）段（P3-2，2026-11-16：由下方分发函数**原样外移**）。
 * @returns true 表示已匹配并处理
 */
async function dispatchSandboxRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Sandbox（沙箱配置与状态，S1）----
  if (method === 'GET' && url === '/v1/sandbox/config') {
    await handleGetSandboxConfig(req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/sandbox/config') {
    await handleUpdateSandboxConfig(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/sandbox/status') {
    await handleGetSandboxStatus(req, res);
    return true;
  }
  return false;
}

/**
 * Auto-reply（自动回复规则）段（P3-2，2026-11-16：由下方分发函数**原样外移**）。
 * @returns true 表示已匹配并处理
 */
async function dispatchAutoReplyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Auto-reply（自动回复规则管理，S2）----
  if (method === 'GET' && url === '/v1/auto-reply/rules') {
    await handleListAutoReplyRules(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/auto-reply/rules') {
    await handleCreateAutoReplyRule(req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/auto-reply\/rules\/(.+)$/)) {
    await handleUpdateAutoReplyRule(
      req,
      res,
      url.match(/^\/v1\/auto-reply\/rules\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/auto-reply\/rules\/(.+)$/)) {
    await handleDeleteAutoReplyRule(
      req,
      res,
      url.match(/^\/v1\/auto-reply\/rules\/(.+)$/)![1]
    );
    return true;
  }
  return false;
}

/**
 * Skills 集合级段（列表 / 系统技能 / 导出导入 / 搜索推荐 / 分类 / 源管理）
 * （P3-2，2026-11-16：由下方分发函数**原样外移**，具体端点仍在通用 `(.+)` 之前）。
 * @returns true 表示已匹配并处理
 */
async function dispatchSkillCollectionRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Skills (ClawHub 生态对接) ----
  if (method === 'GET' && url === '/v1/skills') {
    await handleListSkills(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/system') {
    await handleListSystemSkills(req, res);
    return true;
  }
  // 特定路由须在通用 (.+)$ 之前（v1.5 阶段 2：修复 P1-1~P1-5 被吞/404）
  if (method === 'GET' && url === '/v1/skills/export') {
    await handleExportSkills(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/skills/import') {
    await handleImportSkill(req, res);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/skills\/system\/(.+)\/files\/content$/)
  ) {
    await handleSystemSkillFileContent(
      req,
      res,
      url.match(/^\/v1\/skills\/system\/(.+)\/files\/content$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/skills\/system\/(.+)\/content$/)) {
    await handleSystemSkillContent(
      req,
      res,
      url.match(/^\/v1\/skills\/system\/(.+)\/content$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/search') {
    await handleSearchSkills(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/recommended') {
    await handleRecommendedSkills(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/categories') {
    await handleSkillCategories(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/skills/sources') {
    await handleSkillSources(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/skills/sources') {
    await handleAddSkillSource(req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/skills\/sources\/(.+)$/)) {
    await handleRemoveSkillSource(
      req,
      res,
      url.match(/^\/v1\/skills\/sources\/(.+)$/)![1]
    );
    return true;
  }
  return false;
}

/**
 * Skills 单项段（详情 / 文件 / 安装 / 克隆 / 卸载 / 更新 / 开关 / 增删改）
 * （P3-2，2026-11-16：由下方分发函数**原样外移**，`/files` 与 `/install` 等仍在通用 `(.+)` 之前）。
 * @returns true 表示已匹配并处理
 */
async function dispatchSkillItemRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<boolean> {
  const method = req.method || 'GET';
  if (method === 'GET' && url.match(/^\/v1\/skills\/(.+)\/files$/)) {
    await handleSkillFiles(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/files$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await handleGetSkillDetail(req, res, url.match(/^\/v1\/skills\/(.+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url === '/v1/skills/install') {
    await handleInstallSkill(req, res);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/clone$/)) {
    await handleCloneSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/clone$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/uninstall$/)) {
    await handleUninstallSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/uninstall$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/update$/)) {
    await handleUpdateSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/update$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/toggle$/)) {
    await handleToggleSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/toggle$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/skills') {
    await handleCreateSkill(req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await handleUpdateSkillById(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)$/)![1]
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/skills\/(.+)$/)) {
    await handleDeleteSkill(req, res, url.match(/^\/v1\/skills\/(.+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/enable$/)) {
    await handleEnableSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/enable$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/disable$/)) {
    await handleDisableSkill(
      req,
      res,
      url.match(/^\/v1\/skills\/(.+)\/disable$/)![1]
    );
    return true;
  }
  return false;
}

/**
 * dispatchConfigSkillsRoutes — config-skills-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchConfigSkillsRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  // P3-2（2026-11-16）：各分段原样外移；调用顺序与匹配顺序一致
  if (await dispatchConfigRoutes(req, res, url, handlerCtx)) return true;
  if (await dispatchSettingsRoutes(req, res, url, handlerCtx)) return true;
  if (await dispatchRouterRoutes(req, res, url, handlerCtx)) return true;
  if (await dispatchPermissionRoutes(req, res, url)) return true;
  if (await dispatchSandboxRoutes(req, res, url)) return true;
  if (await dispatchAutoReplyRoutes(req, res, url)) return true;
  if (await dispatchSkillCollectionRoutes(req, res, url)) return true;
  if (await dispatchSkillItemRoutes(req, res, url)) return true;
  return false;
}
