/**
 * 输出风格常量
 * 基于CC源码 cc_code/backend/constants/outputStyles.ts 实现
 * 定义内置输出风格配置
 */

/**
 * 输出风格配置接口
 */
export type OutputStyleConfig = {
  name: string;
  description: string;
  prompt: string;
  source: 'built-in' | 'userSettings' | 'projectSettings' | 'policySettings' | 'plugin';
  keepCodingInstructions?: boolean;
  forceForPlugin?: boolean;
};

/**
 * 默认输出风格名称
 */
export const DEFAULT_OUTPUT_STYLE_NAME = 'default';

/**
 * 内置输出风格配置
 * default风格为null，表示不添加额外提示词
 */
export const OUTPUT_STYLE_CONFIG: Record<string, OutputStyleConfig | null> = {
  [DEFAULT_OUTPUT_STYLE_NAME]: null,
  Explanatory: {
    name: 'Explanatory',
    source: 'built-in',
    description:
      '助手解释其实现选择和代码库模式',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. In addition to software engineering tasks, you should provide educational insights about the codebase along the way.

You should be clear and educational, providing helpful explanations while remaining focused on the task. Balance educational content with task completion. When providing insights, you may exceed typical length constraints, but remain focused and relevant.`,
  },
  Learning: {
    name: 'Learning',
    source: 'built-in',
    description:
      '助手暂停并要求用户编写小段代码以进行实践练习',
    keepCodingInstructions: true,
    prompt: `You are an interactive CLI tool that helps users with software engineering tasks. In addition to software engineering tasks, you should help users learn more about the codebase through hands-on practice and educational insights.

You should be collaborative and encouraging. Balance task completion with learning by requesting user input for meaningful design decisions while handling routine implementation yourself.`,
  },
};

/**
 * 获取当前输出风格配置
 * 优先级：插件强制 > 策略设置 > 项目设置 > 用户设置 > 默认
 */
export function getOutputStyleConfig(
  settings?: { outputStyle?: string },
): OutputStyleConfig | null {
  const outputStyle = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  return OUTPUT_STYLE_CONFIG[outputStyle] ?? null;
}

/**
 * 检查是否使用了自定义输出风格
 */
export function hasCustomOutputStyle(
  settings?: { outputStyle?: string },
): boolean {
  const style = settings?.outputStyle;
  return style !== undefined && style !== DEFAULT_OUTPUT_STYLE_NAME;
}
