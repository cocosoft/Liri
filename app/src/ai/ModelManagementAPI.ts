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
 * 模型管理 REST API 路由聚合入口
 *
 * 为 Tauri 前端提供统一 HTTP API。按业务子域拆分的 handler 位于 ./api/：
 *   ProviderAPI / PricingAPI / ModelAPI / ModelRuntimeAPI /
 *   ConfigAPI / CapabilitiesAPI / TranslateAPI
 * 本文件仅保留 ROUTES 路由表 + tryHandleRoute 分发逻辑。
 * 路由前缀: /v1/providers, /v1/usage, /v1/balance, /v1/pricing
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { sendError, type RouteHandler } from './api/utils.js';
import {
  handleListProviders,
  handleGetProvider,
  handleAddProvider,
  handleUpdateProvider,
  handleDeleteProvider,
  handleToggleProvider,
  handleProviderStats,
  handleProviderTest,
  handleProviderModels,
} from './api/ProviderAPI.js';
import {
  handleUsageSummary,
  handleUsageTrend,
  handleUsageModelStats,
  handleUsageProviderStats,
  handleUsageLogs,
  handleBatchBalances,
  handleBalanceQuery,
  handleListPricing,
  handleUpsertPricing,
  handleDeletePricing,
} from './api/PricingAPI.js';
import {
  handleCreateCustomModel,
  handleBulkImportModels,
  handleToggleModel,
  handleUpdateModel,
  handleDeleteModel,
  handleSyncOfficialPricing,
} from './api/ModelAPI.js';
import {
  handleListModels,
  handleSystemSkillFileContent,
  handleTestModel,
  handleGetCurrentModel,
  handleSwitchModel,
  handleGetTaskDefinitions,
  handleGetTasks,
  handleSaveTasks,
  handleGetPhaseMapping,
  handleSavePhaseMapping,
  handleValidateTasks,
  handleSetDefaultModel,
} from './api/ModelRuntimeAPI.js';
import {
  handleListAppConfigs,
  handleGetAppConfig,
  handleSetAppConfig,
  handleDeleteAppConfig,
  handleListPresets,
  handleGetSoul,
  handlePutSoul,
  handleGetUser,
  handlePutUser,
} from './api/ConfigAPI.js';
import {
  handleListCapabilities,
  handleGetCapability,
  handleCreateCapability,
  handleUpdateCapability,
  handleDeleteCapability,
  handleBatchCapabilities,
  handleGetTaskMappings,
  handleUpdateTaskMappings,
  handleValidateCapabilities,
  handleGetCapabilityCategories,
} from './api/CapabilitiesAPI.js';
import {
  handleTranslateAlternatives,
  handleTranslate,
  handleTranslateHistory,
  handleTranslateStar,
  handleTranslateDelete,
  handleTranslateExport,
  handleTranslateStream,
} from './api/TranslateAPI.js';

interface RouteEntry {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

const ROUTES: RouteEntry[] = [
  // Providers
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/presets$/,
    handler: handleListPresets,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/stats$/,
    handler: handleProviderStats,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)\/test$/,
    handler: handleProviderTest,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)\/models$/,
    handler: handleProviderModels,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/providers\/([^/]+)\/toggle$/,
    handler: handleToggleProvider,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleGetProvider,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleUpdateProvider,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/providers\/([^/]+)$/,
    handler: handleDeleteProvider,
  },
  { method: 'GET', pattern: /^\/v1\/providers$/, handler: handleListProviders },
  { method: 'POST', pattern: /^\/v1\/providers$/, handler: handleAddProvider },

  // Custom Models
  {
    method: 'POST',
    pattern: /^\/v1\/models$/,
    handler: handleCreateCustomModel,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/pricing\/sync$/,
    handler: handleSyncOfficialPricing,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/bulk-import$/,
    handler: handleBulkImportModels,
  },
  {
    method: 'PATCH',
    pattern: /^\/v1\/models\/([^/]+)\/toggle$/,
    handler: handleToggleModel,
  },

  // Model runtime routes (merged from model-handlers.ts)
  {
    method: 'GET',
    pattern: /^\/v1\/models\/tasks\/definitions$/,
    handler: handleGetTaskDefinitions,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/tasks\/validate$/,
    handler: handleValidateTasks,
  },
  { method: 'GET', pattern: /^\/v1\/models\/tasks$/, handler: handleGetTasks },
  { method: 'PUT', pattern: /^\/v1\/models\/tasks$/, handler: handleSaveTasks },

  // S3: Phase mapping routes
  {
    method: 'GET',
    pattern: /^\/v1\/models\/phase-mapping$/,
    handler: handleGetPhaseMapping,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/phase-mapping$/,
    handler: handleSavePhaseMapping,
  },

  {
    method: 'GET',
    pattern: /^\/v1\/models\/current$/,
    handler: handleGetCurrentModel,
  },
  { method: 'POST', pattern: /^\/v1\/models\/test$/, handler: handleTestModel },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/switch$/,
    handler: handleSwitchModel,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/default$/,
    handler: handleSetDefaultModel,
  },
  { method: 'GET', pattern: /^\/v1\/models$/, handler: handleListModels },
  {
    method: 'GET',
    pattern: /^\/v1\/skills\/system\/([^/]+)\/files\/content$/,
    handler: handleSystemSkillFileContent,
  },

  // Usage
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/summary$/,
    handler: handleUsageSummary,
  },
  { method: 'GET', pattern: /^\/v1\/usage\/trend$/, handler: handleUsageTrend },
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/models$/,
    handler: handleUsageModelStats,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/providers$/,
    handler: handleUsageProviderStats,
  },
  { method: 'GET', pattern: /^\/v1\/usage\/logs$/, handler: handleUsageLogs },

  // Balance (统一前缀)
  {
    method: 'GET',
    pattern: /^\/v1\/usage\/balances$/,
    handler: handleBatchBalances,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/usage\/balance$/,
    handler: handleBalanceQuery,
  },

  // Pricing
  { method: 'GET', pattern: /^\/v1\/pricing$/, handler: handleListPricing },
  { method: 'POST', pattern: /^\/v1\/pricing$/, handler: handleUpsertPricing },
  {
    method: 'DELETE',
    pattern: /^\/v1\/pricing\/([^/]+)$/,
    handler: handleDeletePricing,
  },

  // App Model Configs
  {
    method: 'GET',
    pattern: /^\/v1\/models\/app-config$/,
    handler: handleListAppConfigs,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleGetAppConfig,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleSetAppConfig,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/app-config\/([^/]+)$/,
    handler: handleDeleteAppConfig,
  },

  // Capabilities — 特定路由必须在通用路由之前
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities$/,
    handler: handleListCapabilities,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities$/,
    handler: handleCreateCapability,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/task-mappings$/,
    handler: handleGetTaskMappings,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/capabilities\/task-mappings$/,
    handler: handleUpdateTaskMappings,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/categories$/,
    handler: handleGetCapabilityCategories,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities\/batch$/,
    handler: handleBatchCapabilities,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/models\/capabilities\/validate$/,
    handler: handleValidateCapabilities,
  },
  // 通用路由 :key 必须放在最后
  {
    method: 'GET',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleGetCapability,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleUpdateCapability,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/capabilities\/([^/]+)$/,
    handler: handleDeleteCapability,
  },

  // Soul/User
  { method: 'GET', pattern: /^\/v1\/soul$/, handler: handleGetSoul },
  { method: 'PUT', pattern: /^\/v1\/soul$/, handler: handlePutSoul },
  { method: 'GET', pattern: /^\/v1\/user$/, handler: handleGetUser },
  { method: 'PUT', pattern: /^\/v1\/user$/, handler: handlePutUser },

  // Translation
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/stream$/,
    handler: handleTranslateStream,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/history\/delete$/,
    handler: handleTranslateDelete,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/history\/([^/]+)\/star$/,
    handler: handleTranslateStar,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/translate\/alternatives$/,
    handler: handleTranslateAlternatives,
  },
  { method: 'POST', pattern: /^\/v1\/translate$/, handler: handleTranslate },
  {
    method: 'GET',
    pattern: /^\/v1\/translate\/history\/export$/,
    handler: handleTranslateExport,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/translate\/history$/,
    handler: handleTranslateHistory,
  },

  // 通用路由 :id 必须放在最后（否则会劫持 /v1/models/tasks、phase-mapping、default 等特定路由）
  {
    method: 'PUT',
    pattern: /^\/v1\/models\/([^/]+)$/,
    handler: handleUpdateModel,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/models\/([^/]+)$/,
    handler: handleDeleteModel,
  },
];

/**
 * 尝试匹配并处理路由，返回 true 表示已处理
 */
export async function tryHandleRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = req.url?.split('?')[0] || '';
  const method = req.method || 'GET';

  for (const route of ROUTES) {
    if (route.method !== method) continue;

    const match = url.match(route.pattern);
    if (match) {
      try {
        await route.handler(req, res, match);
      } catch (err) {
        await handleError(err, {
          module: 'ai:modelManagement',
          action: 'routeHandler',
        });
        if (!res.headersSent) {
          sendError(
            res,
            `Internal server error: ${(err as Error).message}`,
            500
          );
        }
      }
      return true;
    }
  }

  return false;
}
