/**
 * Model命令执行逻辑
 * 设置AI模型
 * 参考CC源码 cc_code/backend/commands/model/model.tsx 实现
 * 使用 ModelManager 作为唯一数据源
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';
import { modelManager } from '@modules/ai/models/ModelManager.js';
import { MODEL_ALIASES } from '@modules/ai/models/ModelAliases.js';

/**
 * 执行model命令
 */
export async function executeModel(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseModelArgs(args);

    const currentModel = modelManager.getCurrentModel();
    const availableModels = modelManager.getModelInfoList();
    const aliasList = MODEL_ALIASES.join(', ');

    if (!params.model) {
      const currentInfo = availableModels.find((m) => m.id === currentModel);
      const currentName = currentInfo?.name || modelManager.getModelDisplayName(currentModel);

      const modelsList = availableModels
        .map((m) => {
          const marker = m.id === currentModel ? '●' : '○';
          return `  ${marker} ${m.id}: ${m.name}`;
        })
        .join('\n');

      return {
        type: 'text',
        success: true,
        message: `当前模型: ${currentName} (${currentModel})\n\n可用模型:\n${modelsList}\n\n别名: ${aliasList}\n使用 /model <model-id|alias> 切换模型`,
      };
    }

    const resolved = modelManager.resolveModel(params.model);
    if (!resolved) {
      const modelsList = availableModels
        .map((m) => `  - ${m.id}: ${m.name}`)
        .join('\n');

      return {
        type: 'text',
        success: false,
        message: `未知模型: ${params.model}\n\n可用模型:\n${modelsList}\n\n别名: ${aliasList}`,
      };
    }

    modelManager.setCurrentModel(resolved);
    const modelInfo = availableModels.find((m) => m.id === resolved);

    return {
      type: 'text',
      success: true,
      message: `模型已切换为: ${modelInfo?.name || modelManager.getModelDisplayName(resolved)} (${resolved})`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `Model命令执行失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析model命令参数
 */
function parseModelArgs(args: string): {
  model?: string;
} {
  const params: {
    model?: string;
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);

  for (const part of parts) {
    if (!part.startsWith('-')) {
      params.model = part;
      break;
    }
  }

  return params;
}
