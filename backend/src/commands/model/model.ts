/**
 * Model命令执行逻辑
 * 设置AI模型
 * 参考CC源码 cc_code/backend/commands/model/model.tsx 实现
 */

import type { CommandContext, CommandResult } from '../types/index.js';

/**
 * 支持的模型列表
 */
const SUPPORTED_MODELS = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: '最强大的模型，适合复杂任务' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: '平衡性能和速度' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: '高性价比选择' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: '最快响应速度' },
];

/**
 * 获取当前模型
 */
function getCurrentModel(): string {
  return process.env.PY_APP_MODEL || 'claude-sonnet-4-20250514';
}

/**
 * 执行model命令
 */
export async function executeModel(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseModelArgs(args);

    // 如果没有参数，显示当前模型和可用模型列表
    if (!params.model) {
      const currentModel = getCurrentModel();
      const currentModelInfo = SUPPORTED_MODELS.find((m) => m.id === currentModel);

      const modelsList = SUPPORTED_MODELS.map((m) => {
        const marker = m.id === currentModel ? '●' : '○';
        return `  ${marker} ${m.id}: ${m.name}`;
      }).join('\n');

      return {
        type: 'text',
        success: true,
        message: `当前模型: ${currentModelInfo?.name || currentModel}\n\n可用模型:\n${modelsList}\n\n使用 /model <model-id> 切换模型`,
      };
    }

    // 验证模型ID
    const modelInfo = SUPPORTED_MODELS.find((m) => m.id === params.model);

    if (!modelInfo) {
      return {
        type: 'text',
        success: false,
        message: `未知模型: ${params.model}\n\n可用模型:\n${SUPPORTED_MODELS.map((m) => `  - ${m.id}: ${m.name}`).join('\n')}`,
      };
    }

    // 设置模型
    process.env.PY_APP_MODEL = params.model;

    return {
      type: 'text',
      success: true,
      message: `模型已切换为: ${modelInfo.name} (${modelInfo.id})\n\n${modelInfo.description}`,
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
