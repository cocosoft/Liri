/**
 * Model 命令实现
 * 设置 AI 模型
 * 使用 ModelManager 作为唯一数据源
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { modelManager } from '@modules/ai/models/ModelManager.js';
import { MODEL_ALIASES } from '@modules/ai/models/ModelAliases.js';
import {
  ALL_MODEL_CONFIGS,
  getModelKeyByName,
  type ModelKey,
} from '@modules/ai/models/ModelConfigs.js';
import { handleError } from '@modules/error/handleError';

/**
 * 解析命令参数
 */
function parseFlags(args: string): {
  showJson: boolean;
  subcommand: string;
  modelArg: string;
} {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const cleaned = trimmed.replace(/--json\s*/g, '').trim();
  const parts = cleaned.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || '';
  const modelArg = parts.slice(1).join(' ') || parts[0] || '';
  return { showJson, subcommand, modelArg };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  return {
    success: true,
    message: `Model 命令帮助
==================

用法:
  /model                       显示当前模型和可用模型列表
  /model list                  显示当前模型和可用模型列表
  /model set <model-id|alias>  切换到指定模型（支持别名）
  /model set default           恢复默认模型
  /model <model-id|alias>      切换到指定模型（支持别名）
  /model info <model-id>       查看模型详细信息
  /model all                   列出所有提供商下的可用模型
  /model providers             列出当前已配置的供应商
  /model --json                以 JSON 格式输出模型列表
  /model help                  显示此帮助

常用别名:
  sonnet, sonnet[1m]        - Claude Sonnet 4.6
  opus, opus[1m], best      - Claude Opus 4.6
  haiku                     - Claude 3.5 Haiku

示例:
  /model
  /model sonnet
  /model info claude-sonnet-4-6
  /model all
  /model --json

别名: /models, /ml, /list-models`,
  };
}

/**
 * 格式化模型列表为 JSON
 */
function modelsToJson(currentModel: string): Record<string, unknown> {
  const availableModels = modelManager.getModelInfoList();
  return {
    currentModel,
    availableModels: availableModels.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      active: m.id === currentModel,
    })),
    aliases: [...MODEL_ALIASES],
  };
}

/**
 * 获取模型详细信息（上下文窗口、最大输出、定价）
 */
function getModelDetail(modelId: string): {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: string;
} | null {
  const modelKey = getModelKeyByName(modelId);
  if (!modelKey) return null;

  const config = ALL_MODEL_CONFIGS[modelKey];
  const pricing = config.pricing
    ? `输入: $${config.pricing.inputPer1M}/1M tokens, 输出: $${config.pricing.outputPer1M}/1M tokens`
    : '定价信息不可用';

  return {
    id: config.firstParty,
    displayName: config.displayName,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    pricing,
  };
}

/**
 * 处理 info 子命令
 */
function handleInfo(modelArg: string): CommandResult {
  if (!modelArg) {
    return {
      success: false,
      message: `用法: /model info <model-id>\n示例: /model info claude-sonnet-4-6`,
    };
  }

  const resolved = modelManager.resolveModel(modelArg);
  const targetId = resolved || modelArg;

  const detail = getModelDetail(targetId);
  if (!detail) {
    return {
      success: false,
      message: `未知模型: ${modelArg}\n运行 /model 查看可用的模型列表。`,
    };
  }

  return {
    success: true,
    message: `模型详情: ${detail.displayName} (${detail.id})
  上下文窗口: ${detail.contextWindow.toLocaleString()} tokens
  最大输出: ${detail.maxOutputTokens.toLocaleString()} tokens
  定价: ${detail.pricing}`,
  };
}

/**
 * 处理 all 子命令 - 显示所有提供商下的模型
 */
function handleAll(): CommandResult {
  const modelKeys = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[];
  const lines: string[] = ['所有可用模型（按提供商）:\n'];

  for (const key of modelKeys) {
    const config = ALL_MODEL_CONFIGS[key];
    const providers: string[] = [];
    if (config.firstParty) providers.push(`firstParty: ${config.firstParty}`);
    if (config.bedrock) providers.push(`bedrock: ${config.bedrock}`);
    if (config.vertex) providers.push(`vertex: ${config.vertex}`);
    if (config.azure) providers.push(`azure: ${config.azure}`);

    lines.push(`  ${config.displayName} (${key})`);
    for (const p of providers) {
      lines.push(`    ${p}`);
    }
    if (config.pricing) {
      lines.push(
        `    定价: 输入 $${config.pricing.inputPer1M}/1M, 输出 $${config.pricing.outputPer1M}/1M`
      );
    }
    lines.push('');
  }

  return { success: true, message: lines.join('\n').trimEnd() };
}

/**
 * 处理 providers 子命令 - 显示当前已配置的供应商
 */
async function handleProviders(): Promise<CommandResult> {
  try {
    const { providerManager } =
      await import('@modules/ai/providers/ProviderManager.js');
    await providerManager.initialize();
    const providers = await providerManager.listProviders();

    if (providers.length === 0) {
      return {
        success: true,
        message: `暂无供应商配置。

使用 /provider add 添加供应商，或 /provider seed 从环境变量预置。`,
      };
    }

    const lines = ['当前已配置的供应商:', '─'.repeat(80)];

    for (const p of providers) {
      const status = p.isActive ? '✓' : '✗';
      const keyInfo = p.apiKey ? '(已配置 Key)' : '(未配置 Key)';
      lines.push(
        `  ${status} ${p.name.padEnd(18)} | ${p.providerType.padEnd(10)} | ${keyInfo.padEnd(15)} | ${p.baseUrl}`
      );
    }

    lines.push('─'.repeat(80));
    lines.push(
      `共 ${providers.length} 个供应商（${providers.filter((p) => p.isActive).length} 激活）`
    );
    lines.push('');
    lines.push(
      '使用 /model <model-id> 切换模型，使用 /provider toggle <id> 切换供应商状态。'
    );

    return { success: true, message: lines.join('\n') };
  } catch (err) {
    return {
      success: false,
      message: `查询供应商失败: ${(err as Error).message}`,
    };
  }
}

/**
 * 显示当前模型和可用模型列表
 */
function showCurrentModel(showJson: boolean): CommandResult {
  const currentModel = modelManager.getCurrentModel();
  const availableModels = modelManager.getModelInfoList();
  const aliasList = [...MODEL_ALIASES].join(', ');

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(modelsToJson(currentModel), null, 2),
    };
  }

  const currentInfo = availableModels.find((m) => m.id === currentModel);
  const currentName =
    currentInfo?.name || modelManager.getModelDisplayName(currentModel);

  const modelsList = availableModels
    .map((m) => {
      const marker = m.id === currentModel ? '●' : '○';
      return `  ${marker} ${m.id}: ${m.name}`;
    })
    .join('\n');

  return {
    success: true,
    message: `当前模型: ${currentName} (${currentModel})\n\n可用模型:\n${modelsList}\n\n别名: ${aliasList}\n使用 /model <model-id|alias> 切换模型`,
  };
}

/**
 * 切换模型
 */
function switchModel(modelArg: string): CommandResult {
  const resolved = modelManager.resolveModel(modelArg);
  if (!resolved) {
    const availableModels = modelManager.getModelInfoList();
    const modelsList = availableModels
      .map((m) => `  - ${m.id}: ${m.name}`)
      .join('\n');
    const aliasList = [...MODEL_ALIASES].join(', ');

    return {
      success: false,
      message: `未知模型: ${modelArg}\n\n可用模型:\n${modelsList}\n\n别名: ${aliasList}`,
    };
  }

  modelManager.setCurrentModel(resolved);
  const modelInfo = modelManager
    .getModelInfoList()
    .find((m) => m.id === resolved);
  const displayName =
    modelInfo?.name || modelManager.getModelDisplayName(resolved);

  return {
    success: true,
    message: `模型已切换为: ${displayName} (${resolved})`,
  };
}

/**
 * Model 命令实现
 */
const modelCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const { showJson, subcommand, modelArg } = parseFlags(args);

      if (subcommand === 'help') return showHelp();

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_model_command_inline', {
          subcommand: subcommand || 'list',
          showJson,
          args: subcommand || '',
        });
      } catch (err) {
        void handleError(err, {
          module: 'commands:model',
          action: 'catch_error',
        });
      }

      if (subcommand === 'info') return handleInfo(modelArg);

      if (subcommand === 'all') return handleAll();

      if (subcommand === 'providers') return handleProviders();

      if (subcommand === 'list') return showCurrentModel(showJson);

      if (subcommand === 'set') {
        if (!modelArg || modelArg === 'default') {
          const defaultModel = modelManager.getDefaultMainLoopModel();
          modelManager.setCurrentModel(defaultModel);
          return {
            success: true,
            message: `模型已恢复为默认 (${defaultModel})`,
          };
        }
        return switchModel(modelArg);
      }

      if (subcommand && subcommand !== 'list') return switchModel(subcommand);

      return showCurrentModel(showJson);
    } catch (error) {
      return {
        success: false,
        message: `Model 命令执行失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default modelCommand;
