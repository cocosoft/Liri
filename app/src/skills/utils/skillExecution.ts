import { Skill, SkillExecutionContext } from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'skills:utils:skillExecution', level: LogLevel.INFO });

/**
 * 执行技能
 * @param context 技能执行上下文
 * @returns 技能执行结果
 */
export async function executeSkill(
  context: SkillExecutionContext
): Promise<unknown> {
  const { skill, args, toolUseContext } = context;

  try {
    // 验证技能
    if (!skill) {
      throw new AppError(
        'Skill not provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 准备执行上下文
    const executionContext = prepareExecutionContext(
      skill,
      args,
      toolUseContext
    );

    // 获取技能提示
    if (skill.impl.kind !== 'prompt') {
      throw new Error(`Skill ${skill.name} is not a prompt skill`);
    }
    const prompt = await skill.impl.getPromptForCommand(args, executionContext);

    // 处理执行结果
    return processExecutionResult(prompt, skill);
  } catch (error) {
    // 处理执行错误
    return handleExecutionError(error, skill);
  }
}

/**
 * 准备执行上下文
 * @param skill 技能
 * @param args 技能参数
 * @param toolUseContext 工具使用上下文
 * @returns 执行上下文
 */
function prepareExecutionContext(
  skill: Skill,
  args: any,
  toolUseContext: any
): any {
  return {
    ...toolUseContext,
    skillName: skill.name,
    skillSource: skill.source,
    allowedTools: skill.allowedTools,
    // 添加其他上下文信息
  };
}

/**
 * 处理执行结果
 * @param prompt 技能提示
 * @param skill 技能
 * @returns 处理后的结果
 */
function processExecutionResult(
  prompt: { type: string; text: string }[],
  skill: Skill
): any {
  // 处理技能执行结果
  return {
    success: true,
    skill: skill.name,
    prompt,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 处理执行错误
 * @param error 错误对象
 * @param skill 技能
 * @returns 错误处理结果
 */
function handleExecutionError(error: any, skill: Skill): any {
  return {
    success: false,
    skill: skill?.name || 'unknown',
    error: error.message || 'Unknown error',
    timestamp: new Date().toISOString(),
  };
}
