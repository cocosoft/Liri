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
 * App Model Config + Provider Presets + Soul/User 子域 REST API 处理器
 *
 * 路由前缀: /v1/models/app-config, /v1/providers/presets, /v1/soul, /v1/user
 */

import type http from 'http';
import { handleError } from '@modules/error';
import {
  readSoulMd,
  writeSoulMd,
  ensureDefaultSoulMd,
} from '@modules/services/soul/SoulReader';
import {
  readUserMd,
  writeUserMd,
  ensureDefaultUserMd,
} from '@modules/services/soul/UserReader';
import { parseBody, sendJson, sendError } from './utils.js';

export async function handleListAppConfigs(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { appModelConfigService } =
      await import('../models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const configs = await appModelConfigService.getAllConfigs();
    sendJson(res, { data: configs });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listAppConfigs',
    });
    sendError(res, `获取应用配置失败: ${(err as Error).message}`, 500);
  }
}

export async function handleGetAppConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const { appModelConfigService } =
      await import('../models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const config = await appModelConfigService.getConfig(appType);
    if (!config) {
      sendError(res, '应用配置不存在', 404);
      return;
    }
    sendJson(res, { data: config });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'getAppConfig',
    });
    sendError(res, `获取应用配置失败: ${(err as Error).message}`, 500);
  }
}

export async function handleSetAppConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const { appModelConfigService } =
      await import('../models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    const config = await appModelConfigService.setConfig(appType, {
      model: body.model as string | undefined,
      providerId: body.providerId as string | undefined,
      fallbackModel: body.fallbackModel as string | undefined,
      fallbackProviderId: body.fallbackProviderId as string | undefined,
    });
    sendJson(res, { data: config });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'setAppConfig',
    });
    sendError(res, `设置应用配置失败: ${(err as Error).message}`, 500);
  }
}

export async function handleDeleteAppConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  const appType = decodeURIComponent(match![1]);
  try {
    const { appModelConfigService } =
      await import('../models/AppModelConfigService.js');
    await appModelConfigService.initialize();
    await appModelConfigService.deleteConfig(appType);
    sendJson(res, { success: true });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'deleteAppConfig',
    });
    sendError(res, `删除应用配置失败: ${(err as Error).message}`, 500);
  }
}

export async function handleListPresets(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getPresetsByCategory } =
      await import('../providers/providerPresetsData.js');
    const grouped = getPresetsByCategory();
    sendJson(res, { data: grouped });
  } catch (err) {
    await handleError(err, {
      module: 'ai:modelManagement',
      action: 'listPresets',
    });
    sendError(res, `获取预设失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/soul — 读取 SOUL.md 人格定义
 */
export async function handleGetSoul(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    ensureDefaultSoulMd();
    const content = readSoulMd();
    sendJson(res, { data: { content } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'getSoul' });
    sendError(res, `读取人格定义失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/soul — 写入 SOUL.md 人格定义
 */
export async function handlePutSoul(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const content = body.content as string;
    if (typeof content !== 'string' || !content.trim()) {
      sendError(res, 'content 不能为空', 400);
      return;
    }
    writeSoulMd(content);
    sendJson(res, { data: { success: true } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'putSoul' });
    sendError(res, `保存人格定义失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/user — 读取 USER.md 用户身份
 */
export async function handleGetUser(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    ensureDefaultUserMd();
    const content = readUserMd();
    sendJson(res, { data: { content } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'getUser' });
    sendError(res, `读取用户身份失败: ${(err as Error).message}`, 500);
  }
}

/**
 * PUT /v1/user — 写入 USER.md 用户身份
 */
export async function handlePutUser(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const content = body.content as string;
    if (typeof content !== 'string' || !content.trim()) {
      sendError(res, 'content 不能为空', 400);
      return;
    }
    writeUserMd(content);
    sendJson(res, { data: { success: true } });
  } catch (err) {
    await handleError(err, { module: 'ai:modelManagement', action: 'putUser' });
    sendError(res, `保存用户身份失败: ${(err as Error).message}`, 500);
  }
}
