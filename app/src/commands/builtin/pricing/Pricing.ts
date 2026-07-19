/**
 * /pricing 命令实现
 * 查看和管理模型定价
 * 支持：列表查看、定价覆盖、社区同步、恢复默认
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { modelManager } from '@modules/ai';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';
import { load, dump } from 'js-yaml';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:pricing:Pricing',
  level: LogLevel.INFO,
});

interface PricingEntry {
  model: string;
  inputPer1M: number;
  outputPer1M: number;
}

function parseArgs(args: string): {
  subcommand: string;
  flags: Record<string, string>;
  params: string[];
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const flags: Record<string, string> = {};
  const params: string[] = [];
  let subcommand = 'list';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const eqIdx = t.indexOf('=');
      if (eqIdx > 0) {
        flags[t.slice(2, eqIdx)] = t.slice(eqIdx + 1);
      } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
        flags[t.slice(2)] = tokens[++i];
      } else {
        flags[t.slice(2)] = 'true';
      }
    } else if (i === 0) {
      subcommand = t;
    } else {
      params.push(t);
    }
  }

  return { subcommand, flags, params };
}

function formatPrice(val: number): string {
  return `$${val.toFixed(4)}`;
}

function loadPricingYaml(): Record<string, unknown> {
  const pricingPath = join(resolvePyappHome(), 'pricing.yaml');
  if (existsSync(pricingPath)) {
    return (
      (load(readFileSync(pricingPath, 'utf-8')) as Record<string, unknown>) ||
      {}
    );
  }
  return {};
}

function savePricingYaml(data: Record<string, unknown>): void {
  const pricingPath = join(resolvePyappHome(), 'pricing.yaml');
  writeFileSync(pricingPath, dump(data), 'utf-8');
}

async function handleList(args: string): Promise<CommandResult> {
  const { flags } = parseArgs(args);
  const jsonOutput = flags.json === 'true';
  const modelFilter = flags.model || '';

  const registry = modelManager.getModelRegistry();
  const allModels = registry.getAllModels();
  const entries: PricingEntry[] = [];

  for (const model of allModels) {
    const id = model.firstParty;
    if (!id) continue;
    if (modelFilter && !id.toLowerCase().includes(modelFilter.toLowerCase()))
      continue;

    const pricing = registry.getModelPricing(id);
    if (pricing) {
      entries.push({
        model: id,
        inputPer1M: pricing.inputPer1M,
        outputPer1M: pricing.outputPer1M,
      });
    }
  }

  if (jsonOutput) {
    return { success: true, message: JSON.stringify(entries, null, 2) };
  }

  if (entries.length === 0) {
    return {
      success: true,
      message: modelFilter ? `未找到模型: ${modelFilter}` : '暂无定价数据',
    };
  }

  const lines = entries.map((e) => {
    const input = formatPrice(e.inputPer1M);
    const output = formatPrice(e.outputPer1M);
    return `  ${e.model.padEnd(35)} 输入: ${input.padEnd(10)} 输出: ${output}`;
  });

  return {
    success: true,
    message: `模型定价 (每 1M tokens, USD)\n${'─'.repeat(75)}\n${lines.join('\n')}`,
  };
}

async function handleSet(commandArgs: string): Promise<CommandResult> {
  const { params } = parseArgs(commandArgs);
  if (params.length < 1) {
    return {
      success: false,
      message: '用法: /pricing set <model> inputPer1M=X outputPer1M=Y',
    };
  }

  const modelId = params[0];
  const kvPairs = params.slice(1);
  const updates: Record<string, number> = {};

  for (const pair of kvPairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx);
    const val = parseFloat(pair.slice(eqIdx + 1));
    if (isNaN(val)) continue;
    updates[key] = val;
  }

  if (Object.keys(updates).length === 0) {
    return {
      success: false,
      message: '未提供有效的定价参数。示例: inputPer1M=3.5 outputPer1M=17.5',
    };
  }

  const existing = loadPricingYaml();
  const pricing = (existing.pricing as Record<string, unknown>) || {};
  const modelPricing = (pricing[modelId] as Record<string, unknown>) || {};

  for (const [key, val] of Object.entries(updates)) {
    modelPricing[key] = val;
  }
  pricing[modelId] = modelPricing;
  existing.pricing = pricing;

  savePricingYaml(existing);

  const detail = Object.entries(updates)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return { success: true, message: `已更新 ${modelId} 定价: ${detail}` };
}

async function handleSync(commandArgs: string): Promise<CommandResult> {
  const { flags } = parseArgs(commandArgs);
  const sourceUrl = flags.source || undefined;

  if (flags.status === 'true') {
    const cachePath = join(resolvePyappHome(), 'cache', 'pricing.json');
    if (existsSync(cachePath)) {
      const stat = statSync(cachePath);
      return {
        success: true,
        message: `上次同步: ${new Date(stat.mtime).toLocaleString()}`,
      };
    }
    return { success: true, message: '尚未同步过社区定价' };
  }

  try {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();
    const count = await modelPricingService.reSeedFromYaml();
    return {
      success: true,
      message: `YAML 数据重新同步完成，已更新 ${count} 个模型`,
    };
  } catch (e) {
    return {
      success: false,
      message: `同步失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function handleReset(commandArgs: string): Promise<CommandResult> {
  const { flags, params } = parseArgs(commandArgs);
  const modelId = params[0] || flags.model || '';

  if (modelId) {
    const existing = loadPricingYaml();
    const pricing = (existing.pricing as Record<string, unknown>) || {};
    if (pricing[modelId]) {
      delete pricing[modelId];
      existing.pricing = pricing;
      savePricingYaml(existing);
    }
    return { success: true, message: `已恢复 ${modelId} 的定价为默认值` };
  }

  if (flags['user-only'] === 'true') {
    savePricingYaml({ pricing: {} });
    return { success: true, message: '已清除所有用户定价覆盖（社区同步保留）' };
  }

  savePricingYaml({ pricing: {} });

  const cachePath = join(resolvePyappHome(), 'cache', 'pricing.json');
  if (existsSync(cachePath)) {
    unlinkSync(cachePath);
  }

  return { success: true, message: '已清除所有定价覆盖和缓存，恢复全部默认值' };
}

function handleHelp(): CommandResult {
  return {
    success: true,
    message: `Pricing 命令帮助
===================

用法:
  /pricing                         查看所有模型定价
  /pricing list                    同上
  /pricing list --model <id>       查看单个模型定价
  /pricing list --json             以 JSON 格式输出
  /pricing set <model> <key=val>   覆盖定价（写入 ~/.pyapp/pricing.yaml）
  /pricing sync                    从社区源同步最新定价
  /pricing sync --source <url>     从自定义源同步
  /pricing sync --status           查看上次同步时间
  /pricing reset                   恢复全部默认定价
  /pricing reset --model <id>      恢复单个模型定价
  /pricing reset --user-only       仅清除用户覆盖，保留社区同步
  /pricing help                    显示此帮助

示例:
  /pricing
  /pricing list --model <model-id>
  /pricing set <model-id> inputPer1M=3.5 outputPer1M=17.5
  /pricing sync
  /pricing reset --model <model-id>`,
  };
}

const pricingCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const trimmed = args.trim().toLowerCase();

    if (!trimmed || trimmed === 'list') {
      return handleList('');
    }

    const { subcommand } = parseArgs(trimmed);

    switch (subcommand) {
      case 'help':
        return handleHelp();
      case 'list':
        return handleList(trimmed.slice(4).trim());
      case 'set':
        return handleSet(trimmed.slice(3).trim());
      case 'sync':
        return handleSync(trimmed.slice(4).trim());
      case 'reset':
        return handleReset(trimmed.slice(5).trim());
      default:
        return handleHelp();
    }
  },
};

export default pricingCommand;
