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
 * Provider 命令实现
 * 管理 AI 供应商（API Provider）
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolvePyappHome } from '@modules/core/paths';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  providerManager,
  type ProviderType,
} from '@modules/ai/providers/ProviderManager.js';
import {
  testEndpoints,
  formatSpeedResults,
} from '@modules/ai/providers/SpeedTestService.js';
import { fetchModels } from '@modules/ai/providers/ModelFetcher.js';
import {
  registerProviderFromDB,
  unregisterProviderFromRegistry,
  ProviderSyncService,
} from '@modules/ai/providers/ProviderSyncService.js';
import {
  detectUnifiedProviders,
  formatEnvProviderName,
} from '@modules/ai/providers/detectUnifiedProviders.js';

const logger = new Logger({
  level: LogLevel.WARNING,
  module: 'commands:provider',
});

const VALID_PROVIDER_TYPES: ProviderType[] = [
  'openai',
  'deepseek',
  'anthropic',
  'google',
  'ollama',
  'moonshot',
  'grok',
  'bedrock',
  'vertex',
  'azure',
  'custom',
];

// ─── 帮助 ──────────────────────────────────────────────

function showHelp(): CommandResult {
  return {
    success: true,
    message: `Provider 命令 — AI 供应商管理
================================

用法:
  /provider list                 列出所有供应商
  /provider list --json          以 JSON 格式列出供应商
  /provider list <type>          按类型筛选 (openai/deepseek/anthropic等)
  /provider add                 引导式添加新供应商
  /provider add <name> <type> <baseUrl> [apiKey]  快速添加
  /provider edit <id>           编辑供应商
  /provider delete <id>         删除供应商
  /provider toggle <id>         切换启用/停用状态
  /provider info <id>           查看供应商详情
  /provider stats               查看供应商统计
  /provider test <id>           测试端点延迟
  /provider models <id>         获取供应商可用模型列表
  /provider seed                从环境变量预置供应商 (DeepSeek/OpenAI/Anthropic等)
  /provider sync                强制全量同步 DB 供应商到运行环境
  /provider export [<路径>]      导出所有供应商为 JSON（API Key 脱敏）
  /provider import <文件路径>    从 JSON 文件导入供应商
  /provider help                显示此帮助

支持的供应商类型:
  openai, deepseek, anthropic, google, ollama,
  moonshot, grok, bedrock, vertex, azure, custom

别名: /providers, /pv`,
  };
}

// ─── 列表 ──────────────────────────────────────────────

async function handleList(
  args: string,
  showJson: boolean
): Promise<CommandResult> {
  await providerManager.initialize();

  const filterType = VALID_PROVIDER_TYPES.includes(args as ProviderType)
    ? (args as ProviderType)
    : undefined;

  const providers = await providerManager.listProviders({
    providerType: filterType,
  });

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(providers, null, 2),
    };
  }

  if (providers.length === 0) {
    return {
      success: true,
      message: '暂无供应商配置。使用 /provider add 添加第一个供应商。',
    };
  }

  const lines: string[] = [`${'─'.repeat(100)}`];
  lines.push(
    `${'类型'.padEnd(10)} | ${'名称'.padEnd(20)} | ${'ID'.padEnd(36)} | 状态 | Base URL`
  );
  lines.push(`${'─'.repeat(100)}`);

  for (const p of providers) {
    const status = p.isActive ? '启用' : '停用';
    const type = (p.providerType || 'custom').padEnd(10);
    const name = (p.name || '').padEnd(20);
    const id = p.id.substring(0, 34).padEnd(36);
    lines.push(`${type} | ${name} | ${id} | ${status} | ${p.baseUrl}`);
  }

  lines.push(`${'─'.repeat(100)}`);
  lines.push(`共 ${providers.length} 个供应商`);

  return { success: true, message: lines.join('\n') };
}

// ─── 详情 ──────────────────────────────────────────────

async function handleInfo(id: string): Promise<CommandResult> {
  await providerManager.initialize();

  const p = await providerManager.getProvider(id);
  if (!p) {
    return { success: false, message: `未找到供应商: ${id}` };
  }

  const lines = [
    `供应商详情 — ${p.name}`,
    `  ID:         ${p.id}`,
    `  名称:       ${p.name}`,
    `  类型:       ${p.providerType}`,
    `  Base URL:   ${p.baseUrl}`,
    `  Models URL: ${p.modelsUrl || '(未设置，使用默认)'}`,
    `  状态:       ${p.isActive ? '启用' : '停用'}`,
    `  需要 API Key: ${p.requiresAuth ? '是' : '否（本地供应商）'}`,
    `  API Key:    ${p.apiKey ? '已设置' : '(未设置)'}`,
    `  备注:       ${p.notes || '(无)'}`,
    `  排序:       ${p.sortIndex}`,
    `  创建时间:   ${new Date(p.createdAt * 1000).toISOString()}`,
    `  更新时间:   ${new Date(p.updatedAt * 1000).toISOString()}`,
  ];

  return { success: true, message: lines.join('\n') };
}

// ─── 添加 ──────────────────────────────────────────────

async function handleAdd(rawArgs: string): Promise<CommandResult> {
  const hasLocalFlag = /(^|\s)--local(\s|$)/.test(rawArgs);
  const cleanedArgs = rawArgs.replace(/--local\s*/g, '').trim();
  const parts = cleanedArgs.split(/\s+/).filter(Boolean);

  if (parts.length < 3) {
    return {
      success: false,
      message: `用法: /provider add <name> <type> <baseUrl> [apiKey] [--local]

示例:
  /provider add "DeepSeek" deepseek https://api.deepseek.com sk-xxx
  /provider add "Ollama" ollama http://localhost:11434 --local
  /provider add "LM Studio" custom http://localhost:1234/v1 --local

支持的供应商类型: ${VALID_PROVIDER_TYPES.join(', ')}
添加 --local 标记为本地供应商（不需要 API Key）`,
    };
  }

  const name = parts[0];
  const providerType = parts[1].toLowerCase() as ProviderType;

  if (!VALID_PROVIDER_TYPES.includes(providerType)) {
    return {
      success: false,
      message: `无效的供应商类型: ${providerType}。支持的类型: ${VALID_PROVIDER_TYPES.join(', ')}`,
    };
  }

  const baseUrl = parts[2];
  const apiKey = parts.slice(3).join(' ') || undefined;

  await providerManager.initialize();

  let createdId = '';

  try {
    const created = await providerManager.createProvider({
      name,
      providerType,
      baseUrl,
      apiKey,
      requiresAuth: !hasLocalFlag,
    });

    createdId = created.id;

    return {
      success: true,
      message: `供应商已添加:\n  ID:   ${created.id}\n  名称: ${created.name}\n  类型: ${created.providerType}\n  URL:  ${created.baseUrl}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `添加失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // 注册到 ProviderRegistry（失败不阻塞）
    if (createdId) {
      try {
        await registerProviderFromDB(createdId);
      } catch {
        // 静默忽略
      }
    }
  }
}

// ─── 编辑 ──────────────────────────────────────────────

async function handleEdit(args: string): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/).filter(Boolean);

  if (parts.length < 2) {
    return {
      success: false,
      message: `用法: /provider edit <id> <字段>=<值> ...

字段: name, type, baseUrl, apiKey, modelsUrl, notes, requiresAuth
示例:
  /provider edit abc-123 name="New Name"
  /provider edit abc-123 baseUrl=https://new.api.com apiKey=sk-new
  /provider edit abc-123 requiresAuth=false   # 设为本地供应商`,
    };
  }

  const id = parts[0];
  const updates: Record<string, string> = {};

  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx === -1) continue;
    const field = parts[i].substring(0, eqIdx);
    const value = parts[i].substring(eqIdx + 1);
    updates[field] = value;
  }

  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      message: '未指定要更新的字段。用法: /provider edit <id> <字段>=<值> ...',
    };
  }

  await providerManager.initialize();

  const params: Record<string, string | boolean | undefined> = {};

  if (updates['name']) params.name = updates['name'];
  if (updates['type']) {
    if (!VALID_PROVIDER_TYPES.includes(updates['type'] as ProviderType)) {
      return {
        success: false,
        message: `无效的供应商类型: ${updates['type']}`,
      };
    }
    params.providerType = updates['type'];
  }
  if (updates['baseUrl']) params.baseUrl = updates['baseUrl'];
  if (updates['apiKey']) params.apiKey = updates['apiKey'];
  if (updates['modelsUrl']) params.modelsUrl = updates['modelsUrl'];
  if (updates['notes']) params.notes = updates['notes'];
  if (updates['requiresAuth'] !== undefined) {
    params.requiresAuth = updates['requiresAuth'].toLowerCase() !== 'false';
  }

  try {
    const updated = await providerManager.updateProvider(id, params);
    if (!updated) {
      return { success: false, message: `未找到供应商: ${id}` };
    }

    // 编辑后重新注册（baseUrl/apiKey 可能变化）
    try {
      unregisterProviderFromRegistry(id);
      if (updated.isActive) {
        await registerProviderFromDB(id);
      }
    } catch {
      logger.warning('更新供应商后注册表同步失败', { id, name: updated.name });
    }

    return {
      success: true,
      message: `供应商已更新: ${updated.name}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `更新失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── 删除 ──────────────────────────────────────────────

async function handleDelete(id: string): Promise<CommandResult> {
  await providerManager.initialize();

  const provider = await providerManager.getProvider(id);
  if (!provider) {
    return { success: false, message: `未找到供应商: ${id}` };
  }

  await providerManager.deleteProvider(id);

  // 从 ProviderRegistry 移除
  try {
    unregisterProviderFromRegistry(id);
  } catch {
    logger.warning('删除供应商后注册表清理失败', { id, name: provider.name });
  }

  return {
    success: true,
    message: `已删除供应商: ${provider.name} (${id})`,
  };
}

// ─── 切换 ──────────────────────────────────────────────

async function handleToggle(id: string): Promise<CommandResult> {
  await providerManager.initialize();

  const provider = await providerManager.getProvider(id);
  if (!provider) {
    return { success: false, message: `未找到供应商: ${id}` };
  }

  const newState = !provider.isActive;
  await providerManager.toggleProvider(id, newState);

  // 根据新状态注册/注销 ProviderRegistry
  try {
    if (newState) {
      await registerProviderFromDB(id);
    } else {
      unregisterProviderFromRegistry(id);
    }
  } catch {
    logger.warning('切换供应商状态后注册表同步失败', {
      id,
      name: provider.name,
      enabled: newState,
    });
  }

  return {
    success: true,
    message: `供应商已${newState ? '启用' : '停用'}: ${provider.name}`,
  };
}

// ─── 统计 ──────────────────────────────────────────────

async function handleStats(): Promise<CommandResult> {
  await providerManager.initialize();

  const stats = await providerManager.getProviderStats();
  const providers = await providerManager.listProviders();

  if (stats.length === 0) {
    return {
      success: true,
      message: '暂无供应商数据。',
    };
  }

  const lines = ['供应商统计', '─'.repeat(40)];
  for (const s of stats) {
    lines.push(`  ${s.type.padEnd(12)}: ${s.active}/${s.count} 启用`);
  }
  lines.push('─'.repeat(40));
  lines.push(
    `  总计: ${providers.filter((p) => p.isActive).length}/${providers.length} 启用`
  );

  return { success: true, message: lines.join('\n') };
}

// ─── 端点测速 ──────────────────────────────────────────

async function handleTest(id: string): Promise<CommandResult> {
  await providerManager.initialize();

  const provider = await providerManager.getProvider(id);
  if (!provider) {
    return { success: false, message: `未找到供应商: ${id}` };
  }

  if (!provider.apiKey) {
    return {
      success: false,
      message: `供应商 ${provider.name} 未设置 API Key，无法进行测速。`,
    };
  }

  const urls = [provider.baseUrl];

  const result = await testEndpoints(urls);
  const message = [
    `端点测速 — ${provider.name} (${provider.providerType})`,
    formatSpeedResults(result),
  ].join('\n');

  return { success: true, message };
}

// ─── 模型列表获取 ──────────────────────────────────────

async function handleModels(id: string): Promise<CommandResult> {
  await providerManager.initialize();

  const provider = await providerManager.getProvider(id);
  if (!provider) {
    return { success: false, message: `未找到供应商: ${id}` };
  }

  if (!provider.apiKey) {
    return {
      success: false,
      message: `供应商 ${provider.name} 未设置 API Key，无法获取模型列表。`,
    };
  }

  const result = await fetchModels(
    provider.baseUrl,
    provider.apiKey,
    provider.modelsUrl
  );

  if ('error' in result) {
    return { success: false, message: `获取模型列表失败: ${result.error}` };
  }

  const lines = [
    `模型列表 — ${provider.name} (${result.usedUrl})`,
    `共 ${result.models.length} 个模型:`,
  ];

  for (const model of result.models) {
    const vendor = model.ownedBy ? ` [${model.ownedBy}]` : '';
    lines.push(`  - ${model.id}${vendor}`);
  }

  return { success: true, message: lines.join('\n') };
}

// ─── 预置供应商 ────────────────────────────────────────

/** 导出所有供应商到 JSON 文件 */
async function handleExport(outputPath?: string): Promise<CommandResult> {
  await providerManager.initialize();

  const providers = await providerManager.listProviders();

  if (providers.length === 0) {
    return { success: true, message: '暂无供应商可导出。' };
  }

  // 导出时脱敏 API Key（仅保留前4后4位）
  const exportable = providers.map((p) => ({
    ...p,
    apiKey: p.apiKey
      ? `${p.apiKey.substring(0, 4)}****${p.apiKey.substring(p.apiKey.length - 4)}`
      : undefined,
  }));

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: 1,
    count: exportable.length,
    providers: exportable,
  };

  const json = JSON.stringify(exportData, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, json, 'utf-8');
    return {
      success: true,
      message: `已导出 ${exportable.length} 个供应商到: ${outputPath}`,
    };
  }

  // 兜底：输出到终端
  return {
    success: true,
    message: `已导出 ${exportable.length} 个供应商（JSON 格式）:\n\n${json}`,
  };
}

/** 从 JSON 文件导入供应商 */
async function handleImport(filePath: string): Promise<CommandResult> {
  if (!filePath) {
    return {
      success: false,
      message:
        '用法: /provider import <文件路径>\n示例: /provider import ~/.pyapp/providers-export.json',
    };
  }

  if (!existsSync(filePath)) {
    return { success: false, message: `文件不存在: ${filePath}` };
  }

  let data: { providers?: Array<Record<string, unknown>>; version?: number };
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return { success: false, message: `文件不是有效的 JSON: ${filePath}` };
  }

  if (!data.providers || !Array.isArray(data.providers)) {
    return {
      success: false,
      message: `无效的导出文件格式（缺少 providers 数组）`,
    };
  }

  await providerManager.initialize();
  const existing = await providerManager.listProviders();
  const existingBaseUrls = new Set(
    existing.map((p) => `${p.name}:${p.baseUrl}`)
  );

  let imported = 0;
  let skipped = 0;

  for (const item of data.providers) {
    const key = `${item.name || ''}:${item.baseUrl || ''}`;
    if (existingBaseUrls.has(key)) {
      skipped++;
      continue;
    }

    try {
      // 导入时 apiKey 是脱敏的，需要提示用户重新设置
      const created = await providerManager.createProvider({
        name: (item.name as string) || 'Imported',
        providerType: (item.providerType as ProviderType) || 'custom',
        baseUrl: (item.baseUrl as string) || 'https://api.example.com',
        // apiKey 导入为脱敏版本，用户需手动修改
        apiKey: undefined,
        modelsUrl: item.modelsUrl as string | undefined,
        notes: item.notes as string | undefined,
        icon: item.icon as string | undefined,
        iconColor: item.iconColor as string | undefined,
      });
      existingBaseUrls.add(`${created.name}:${created.baseUrl}`);
      imported++;
    } catch {
      skipped++;
    }
  }

  return {
    success: true,
    message: `导入完成: ${imported} 新增, ${skipped} 跳过（已存在或格式错误）。\n注意: API Key 为脱敏格式，请使用 /provider edit 重新设置。`,
  };
}

// ─── 预置供应商 ────────────────────────────────────────

/** 强制全量同步 DB → ProviderRegistry */
async function handleSync(): Promise<CommandResult> {
  try {
    const count = await ProviderSyncService.syncDBProvidersToRegistry();

    if (count === 0) {
      const providers = await providerManager.listProviders();
      return {
        success: true,
        message: `同步完成: 0 个供应商（数据库中 ${providers.length} 个，可能已全部停用或同步失败）`,
      };
    }

    return {
      success: true,
      message: `已同步 ${count} 个供应商到运行环境。`,
    };
  } catch (err) {
    return {
      success: false,
      message: `同步失败: ${(err as Error).message}`,
    };
  }
}

// ─── 预置供应商 ────────────────────────────────────────

/** 从环境变量检测预置的供应商配置 */
async function handleSeed(): Promise<CommandResult> {
  const unified = detectUnifiedProviders();

  if (unified.length === 0) {
    return {
      success: true,
      message:
        '未检测到环境变量中的 API Key。\n' +
        '支持两种方式配置环境变量：\n\n' +
        '  方式一（统一格式，支持任意供应商）：\n' +
        '    PROVIDER_DEEPSEEK_KEY=sk-xxx\n' +
        '    PROVIDER_DEEPSEEK_TYPE=deepseek\n' +
        '    PROVIDER_DEEPSEEK_URL=https://api.deepseek.com\n\n' +
        '  方式二（专用变量名，大厂快捷配置）：\n' +
        '    DEEPSEEK_API_KEY=sk-xxx\n' +
        '    DEEPSEEK_BASE_URL=https://api.deepseek.com\n' +
        '    OPENAI_API_KEY=sk-xxx\n' +
        '    ANTHROPIC_API_KEY=sk-xxx\n' +
        '    GOOGLE_API_KEY=xxx\n' +
        '    SILICONFLOW_API_KEY=sk-xxx\n\n' +
        '也可以手动添加: /provider add "My API" <type> <url> <key>',
    };
  }

  const presets = unified.map((p) => ({
    name: formatEnvProviderName(p.name),
    providerType: p.providerType as ProviderType,
    baseUrl: p.baseUrl || '',
    apiKey: p.apiKey,
  }));

  await providerManager.initialize();

  // 跳过已存在的供应商（按 name + type 去重）
  const existing = await providerManager.listProviders();
  const existingKeys = new Set(
    existing.map((p) => `${p.name}:${p.providerType}`)
  );

  const newPresets = presets.filter(
    (p) => !existingKeys.has(`${p.name}:${p.providerType}`)
  );

  if (newPresets.length === 0) {
    return {
      success: true,
      message: `已检测到 ${presets.length} 个环境变量供应商，但它们都已存在于数据库中。`,
    };
  }

  const added: string[] = [];

  for (const preset of newPresets) {
    try {
      const created = await providerManager.createProvider(preset);
      added.push(created.name);

      // 注册到 ProviderRegistry
      try {
        await registerProviderFromDB(created.id);
      } catch {
        logger.warning('添加供应商后注册表同步失败', {
          id: created.id,
          name: created.name,
        });
      }
    } catch (err) {
      // 预置失败不阻塞
    }
  }

  return {
    success: true,
    message: `已从环境变量预置 ${added.length} 个供应商:\n${added.map((n) => `  - ${n}`).join('\n')}\n\n使用 /provider list 查看全部。`,
  };
}

// ─── 命令执行入口 ──────────────────────────────────────

const providerCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const trimmed = args.trim();
    const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
    const cleaned = trimmed.replace(/--json\s*/g, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase() || 'list';
    const rest = parts.slice(1).join(' ');

    try {
      switch (subcommand) {
        case 'help':
          return showHelp();

        case 'list':
          return handleList(rest, showJson);

        case 'info':
          if (!rest) {
            return { success: false, message: '用法: /provider info <id>' };
          }
          return handleInfo(rest.split(/\s+/)[0]);

        case 'add':
          return handleAdd(rest);

        case 'edit':
          return handleEdit(rest);

        case 'delete':
        case 'remove':
          if (!rest) {
            return { success: false, message: '用法: /provider delete <id>' };
          }
          return handleDelete(rest.split(/\s+/)[0]);

        case 'toggle':
          if (!rest) {
            return { success: false, message: '用法: /provider toggle <id>' };
          }
          return handleToggle(rest.split(/\s+/)[0]);

        case 'stats':
          return handleStats();

        case 'seed':
          return handleSeed();

        case 'sync':
          return handleSync();

        case 'export':
          return handleExport(rest || undefined);

        case 'import':
          return handleImport(rest);

        case 'test':
          if (!rest) {
            return { success: false, message: '用法: /provider test <id>' };
          }
          return handleTest(rest.split(/\s+/)[0]);

        case 'models':
        case 'fetch':
          if (!rest) {
            return { success: false, message: '用法: /provider models <id>' };
          }
          return handleModels(rest.split(/\s+/)[0]);

        default:
          // 如果没有子命令，默认显示列表
          if (!parts[0]) {
            return handleList('', false);
          }
          return {
            success: false,
            message: `未知子命令: ${subcommand}\n使用 /provider help 查看帮助。`,
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Provider 命令执行失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default providerCommand;
