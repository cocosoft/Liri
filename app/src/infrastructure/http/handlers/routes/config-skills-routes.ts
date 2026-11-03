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
  handleGetPermissionMetrics,
  handleListPermissionRules,
} from '../permission-handlers';
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
  const method = req.method || 'GET';
  // ---- Config ----
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

  // ---- Router（智能路由）----
  if (method === 'GET' && url === '/v1/router/config') {
    await handleRouterGetConfig(handlerCtx, req, res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/router/config') {
    await handleRouterUpdateConfig(handlerCtx, req, res);
    return true;
  }

  // ---- Permissions（工具权限规则管理，P1-5）----
  if (method === 'GET' && url === '/v1/permissions/metrics') {
    await handleGetPermissionMetrics(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/permissions/rules') {
    await handleListPermissionRules(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/permissions/rules') {
    await handleAddPermissionRule(req, res);
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
  // P3-3 第二步（2026-11-03）：D 体系（细粒度用户/角色/资源/grant）HTTP 入口已摘除。
  // 存储与决策桥接（PermissionManager 的角色 deny）仍保留，待观察期后再按 CD01-CD06 处理。

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
