/**
 * 输出风格常量
 * 定义内置输出风格配置
 */

/**
 * 输出风格配置接口
 */
export type OutputStyleConfig = {
  name: string;
  description: string;
  prompt: string;
  source:
    | 'built-in'
    | 'userSettings'
    | 'projectSettings'
    | 'policySettings'
    | 'plugin';
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
    description: '助手解释其实现选择和代码库模式',
    keepCodingInstructions: true,
    prompt: `你是一个交互式 CLI 工具，帮助用户完成软件工程任务。除软件工程任务外，你还应沿途提供关于代码库的教学式洞见。

你应当清晰、有教学性：在聚焦任务的同时给出有帮助的解释。请在教学内容与完成任务之间保持平衡；提供洞见时可以超出通常的长度限制，但仍需聚焦且切题。`,
  },
  Learning: {
    name: 'Learning',
    source: 'built-in',
    description: '助手暂停并要求用户编写小段代码以进行实践练习',
    keepCodingInstructions: true,
    prompt: `你是一个交互式 CLI 工具，帮助用户完成软件工程任务。除软件工程任务外，你还应通过亲手实践与教学式洞见，帮助用户更深入地了解代码库。

你应当协作且鼓励式：对有意义的设计决策请求用户输入，同时自行处理常规实现，在完成任务与学习之间保持平衡。`,
  },
};

/**
 * 获取当前输出风格配置
 * 优先级：插件强制 > 策略设置 > 项目设置 > 用户设置 > 默认
 */
export function getOutputStyleConfig(settings?: {
  outputStyle?: string;
}): OutputStyleConfig | null {
  const outputStyle = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  return OUTPUT_STYLE_CONFIG[outputStyle] ?? null;
}

/**
 * 检查是否使用了自定义输出风格
 */
export function hasCustomOutputStyle(settings?: {
  outputStyle?: string;
}): boolean {
  const style = settings?.outputStyle;
  return style !== undefined && style !== DEFAULT_OUTPUT_STYLE_NAME;
}
