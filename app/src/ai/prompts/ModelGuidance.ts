/**
 * 模型特定指引
 * 提供不同模型/提供商的工具使用和交互行为指引
 * 注入到 system prompt 中，优化模型行为
 */

/**
 * 条件注入模式
 * - auto: 根据模型类型自动决定是否注入
 * - on: 始终注入模型特定指引
 * - off: 不注入任何模型特定指引
 */
export type ModelGuidanceMode = 'auto' | 'on' | 'off';

/**
 * 模型特定指引配置
 */
export interface ModelGuidanceConfig {
  /** 注入模式，默认 auto */
  mode: ModelGuidanceMode;
  /** 始终注入工具执行指引的模型名称子串列表 */
  toolEnforcementModels: string[];
}

/** 默认配置 */
export const DEFAULT_GUIDANCE_CONFIG: ModelGuidanceConfig = {
  mode: 'auto',
  toolEnforcementModels: [
    'deepseek',
    'claude',
    'gpt',
    'gemini',
    'o1',
    'o3',
    'o4',
  ],
};

/**
 * 工具使用执行指引（通用）
 * 所有提供商共享的基础工具使用行为规范
 * 参考 Hermes agent/prompt_builder.py TOOL_USE_ENFORCEMENT_GUIDANCE
 */
export const TOOL_USE_ENFORCEMENT_GUIDANCE = `## 工具使用执行指引

你必须使用工具来采取行动——不要只描述你打算做什么而不实际执行。当你承诺执行某个操作时（例如“我会运行测试”、“让我检查一下文件”、“我将创建项目”），你必须立即在同一轮响应中进行相应的工具调用。永远不要以承诺未来行动来结束你的回合——立即执行。

持续工作直到任务实际完成。不要只总结你计划下一步做什么就停下来。如果你有可用的工具可以完成任务，就使用它们，而不是告诉用户你会做什么。

每轮响应要么：(a) 包含推进任务的工具调用，要么 (b) 向用户交付最终结果。只描述意图而不采取行动的响应是不可接受的。`;

/**
 * DeepSeek 模型特定指引
 * 针对 DeepSeek 模型的推理链行为和工具调用规范
 */
export const DEEPSEEK_GUIDANCE = `## DeepSeek 模型特定指引

### 推理链行为
- 本模型的推理链较长，在每步工具调用前清晰说明当前目标
- 利用模型的推理能力分析错误信息，但不要过度推理——看到错误后先确认根因再行动
- 在工具调用之间保持推理连贯，说明从结果中得出的结论

### 工具调用规范
- 本模型支持单轮多次工具调用，充分利用并行能力
- 当需要读取多个文件时，一次性发出所有 Read 调用
- 确认操作正确后立即执行下一步，避免不必要的确认循环`;

/**
 * Claude 模型特定指引
 */
export const CLAUDE_GUIDANCE = `## Claude 模型特定指引

### 工具使用规范
- 每次工具调用后认真分析返回结果，提取关键信息
- 优先使用 Read 工具获取完整上下文，避免基于摘要做判断
- 对大文件的修改使用精确的行范围定位，避免不必要的全文重写

### 交互建议
- 利用 Claude 的结构化输出能力，保持响应清晰简洁
- 当需要多步操作时，先规划再执行，每步确认结果后再继续`;

/**
 * OpenAI GPT 模型特定指引
 */
export const OPENAI_GUIDANCE = `## GPT 模型特定指引

### 工具使用规范
- 每个工具调用前明确说明目标
- 合理拆分复杂任务为多个步骤，利用 GPT 的逐步推理能力
- 善用系统内置函数调用机制，一次提出所有需要的并行调用

### 交互建议
- GPT 对结构化指令响应较好，使用清晰的标记组织思考
- 在结果分析时注意检查输出格式和内容完整性`;

/**
 * Google Gemini 模型特定指引
 * 参考 Hermes agent/prompt_builder.py GOOGLE_MODEL_OPERATIONAL_GUIDANCE
 */
export const GOOGLE_GUIDANCE = `## Google 模型特定指引

### 路径处理
- **绝对路径：** 始终构建和使用绝对文件路径进行文件系统操作。将项目根目录与相对路径组合。
- **验证先行：** 在执行修改前使用 read_file/search_files 检查文件内容和项目结构。永远不要猜测文件内容。

### 依赖检查
- **永远不要假设库可用。** 在使用前检查 package.json、requirements.txt、Cargo.toml 等。

### 交互风格
- **简洁性：** 保持解释性文本简短——几句话即可，不要段落。聚焦于行动和结果而非叙述。
- **并行工具调用：** 当需要执行多个独立操作（例如读取多个文件）时，在一轮响应中发出所有工具调用，而不是顺序执行。
- **非交互命令：** 使用 -y、--yes、--non-interactive 等标志，避免命令阻塞等待输入。

### 上下文利用
- 本模型拥有超大上下文窗口，可一次性处理更多信息
- 优先通过工具调用获取完整文件内容，而非截断摘要
- 利用大上下文优势减少中间推理步骤`;

/**
 * 本地/Ollama 模型特定指引
 */
export const OLLAMA_GUIDANCE = `## 本地模型特定指引

### 资源优化
- 响应速度受本地资源限制，尽量减少不必要的工具调用
- 优先使用 Read 工具的精确行范围减少输出量
- 单步目标尽量聚焦，避免过长的推理链

### 交互建议
- 保持指令简洁明确，减少模型的推理负担
- 每次只推进一个子任务，确认完成后再继续下一步`;

/** P2-14: Qwen 模型特定指引 */
export const QWEN_GUIDANCE = `## Qwen 模型特定指引
- 并行工具调用: Qwen 支持原生并行工具调用，可批量发送独立工具
- 绝对路径: 始终使用绝对文件路径，不依赖相对路径
- 简洁输出: 优先输出执行结果，减少冗余解释
- 函数调用优先: 有工具可用时优先调用工具，避免纯文本推测`;

/** P2-14: GLM 模型特定指引 */
export const GLM_GUIDANCE = `## GLM 模型特定指引
- 工具调用格式: 严格遵循 OpenAI function-calling 格式
- 单次一步: 每次只调用一个工具，避免批量并行
- 中文优先: 用中文回复用户，技术内容可混合英文
- 参数验证: 调用工具前检查必填参数是否完整`;

/** P2-14: Grok 模型特定指引 */
export const GROK_GUIDANCE = `## Grok 模型特定指引
- 工具使用: 优先使用工具获取实时信息，而非依赖训练数据
- 搜索能力: 充分利用 web_search 工具获取最新信息
- 代码执行: 数学和代码任务使用工具验证结果
- 简洁回应: 直接回答问题，减少不必要的前言`;

/** P2-14: Codex 模型特定指引 */
export const CODEX_GUIDANCE = `## Codex 模型特定指引
- 代码生成优先: 使用 write_file/edit_file 直接生成代码
- 增量编辑: 使用 replace_in_file 进行精确的字符串替换
- 预检操作: 修改前先用 read_file 读取文件内容
- 验证循环: 修改后用 grep/read 验证结果`;

/** P2-14: Gemma 模型特定指引 */
export const GEMMA_GUIDANCE = `## Gemma 模型特定指引
- 会话长度: 注意 Gemma 上下文窗口限制，避免超长输入
- 工具约束: Gemma 工具调用格式有特殊要求，使用标准 JSON
- 简洁优先: Gemma 对长文本处理有限，输出精炼
- 单任务聚焦: 每次专注一个任务，避免多任务并行`;

/**
 * 提供商特定指引映射
 */
export const PROVIDER_GUIDANCE: Record<string, string> = {
  deepseek: DEEPSEEK_GUIDANCE,
  anthropic: CLAUDE_GUIDANCE,
  openai: OPENAI_GUIDANCE,
  google: GOOGLE_GUIDANCE,
  ollama: OLLAMA_GUIDANCE,
  qwen: QWEN_GUIDANCE,
  glm: GLM_GUIDANCE, // P2-14: 修复键名拼写 glma→glm
  grok: GROK_GUIDANCE,
  codex: CODEX_GUIDANCE,
  gemma: GEMMA_GUIDANCE,
};

/**
 * 检查是否需要工具执行指引
 */
function needsToolEnforcement(
  provider: string,
  modelName: string,
  config: ModelGuidanceConfig
): boolean {
  if (config.mode === 'off') return false;
  if (config.mode === 'on') return true;

  const modelLower = modelName.toLowerCase();
  return config.toolEnforcementModels.some((pattern) =>
    modelLower.includes(pattern.toLowerCase())
  );
}

/**
 * 获取模型特定指引
 * @param provider 提供商标识
 * @param modelName 模型名称
 * @param config 可选配置，默认使用 DEFAULT_GUIDANCE_CONFIG
 * @returns 组合的指引字符串，如果 mode 为 off 则返回空字符串
 */
export function getModelGuidance(
  provider: string,
  modelName: string,
  config: ModelGuidanceConfig = DEFAULT_GUIDANCE_CONFIG
): string {
  if (config.mode === 'off') return '';

  const providerLower = provider.toLowerCase();
  const parts: string[] = [];

  const providerSpecific = PROVIDER_GUIDANCE[providerLower];
  if (providerSpecific) {
    parts.push(providerSpecific);
  }

  if (needsToolEnforcement(providerLower, modelName, config)) {
    parts.push(TOOL_USE_ENFORCEMENT_GUIDANCE);
  }

  return parts.join('\n\n');
}

/**
 * 获取工具使用指引（简化版，不依赖配置）
 * 仅根据模型名称/提供商决定是否注入
 */
export function getToolUseGuidance(
  provider: string,
  modelName: string
): string {
  const modelLower = modelName.toLowerCase();

  // TODO: CS02-ROOTFIX — 通过 modelLower.includes() 匹配违反 CS02。
  // 根因方案：从 model_registry.capabilities 查询模型能力，而非按名称匹配。
  if (
    modelLower.includes('deepseek') ||
    provider === 'deepseek' ||
    modelLower.includes('claude') ||
    modelLower.includes('gpt') ||
    modelLower.includes('o1') ||
    modelLower.includes('o3') ||
    modelLower.includes('o4') ||
    modelLower.includes('gemini')
  ) {
    return TOOL_USE_ENFORCEMENT_GUIDANCE;
  }

  return TOOL_USE_ENFORCEMENT_GUIDANCE;
}
