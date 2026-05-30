/**
 * 系统提示词模板（遵循规则K：品牌使用Liri，不使用Anthropic/CLAUDE）
 */
import * as os from 'os';

export interface SystemPromptParts {
  basePrompt: string[];
  userContext: Record<string, string>;
  systemContext: Record<string, string>;
}

/**
 * 构建基础系统提示词数组，用于初始化 AI 助手的身份和行为准则。
 * @deprecated 功能已迁移至 systemPromptSections 的 identity/toolUse 段落。
 *             请使用 PromptAssembler.assembleSystemPrompt() 替代。
 *
 * @param tools - 可用工具的名称列表。虽然当前实现中未直接使用该参数动态生成内容，
 *                但保留此参数以支持未来扩展或上下文注入。默认为空数组。
 * @returns 返回一个字符串数组，每个元素代表一条系统提示指令，按逻辑分段组织。
 */
export function buildBasePrompt(tools: string[] = []): string[] {
  return [
    `你是 Liri，一个强大的AI私人助手。`,
    `你不是Claude，不是Anthropic，也不是任何其他AI助手。`,
    `你的身份是 Liri——绝不自称为Claude、Anthropic或任何其他助手。`,
    `当被要求自我介绍时，始终回答你是 Liri。`,
    ``,
    `你可以使用一系列工具与用户的系统进行交互。`,
    `使用这些工具帮助用户完成任务。`,
    ``,
    `修改文件时：`,
    `- 使用可用工具先读取文件再编辑`,
    `- 做精准、最小化的修改`,
    `- 除非明确要求，否则不添加注释`,
    ``,
    `执行命令时：`,
    `- 先说明你要做什么`,
    `- 必要时等待用户确认`,
    `- 清晰地报告结果`,
  ];
}

/**
 * 构建用户上下文信息对象
 * @deprecated 功能已迁移至 systemPromptSections + PlatformHints.buildEnvironmentHints()。
 *             请使用 PromptAssembler.assembleSystemPrompt() 替代。
 *
 * @param info - 包含平台、工作目录、分支和日期等可选信息的对象
 * @param info.platform - 可选的平台标识，若未提供则使用当前进程的平台
 * @param info.cwd - 可选的当前工作目录，若未提供则使用进程当前工作目录
 * @param info.branch - 可选的 Git 分支名称，若为 null 或未提供则不包含在结果中
 * @param info.date - 可选的日期字符串，若未提供则使用当前日期的 ISO 格式（YYYY-MM-DD）
 * @returns 一个包含平台、工作目录、日期、主机名以及可选 Git 分支信息的键值对记录
 */
export function buildUserContext(info: {
  platform?: string;
  cwd?: string;
  branch?: string | null;
  date?: string;
}): Record<string, string> {
  // 合并默认值与传入参数，构建基础上下文信息
  return {
    platform: info.platform || process.platform,
    cwd: info.cwd || process.cwd(),
    date: info.date || new Date().toISOString().split('T')[0],
    hostname: os.hostname(),
    // 仅当 branch 存在且非空时，才添加 gitBranch 字段
    ...(info.branch ? { gitBranch: info.branch } : {}),
  };
}

/**
 * 根据提供的项目信息构建系统上下文对象。
 * @deprecated 功能已迁移至 systemPromptSections 的 gitContext/projectMeta 段落。
 *             请使用 PromptAssembler.assembleSystemPrompt() 替代。
 *
 * 该函数会过滤掉空值或未定义的字段，仅将存在的有效信息添加到返回的上下文中。
 *
 * @param info - 包含项目元数据的输入对象
 * @param info.gitStatus - Git 状态信息（可选）
 * @param info.pyAppMd - Python 应用相关的 Markdown 内容（可选）
 * @param info.memoryMd - 记忆相关的 Markdown 内容（可选）
 * @param info.readme - 项目 README 内容（可选）
 * @param info.projectName - 项目名称（可选）
 * @returns 一个键值对记录，仅包含非空且已定义的系统上下文信息
 */
export function buildSystemContext(info: {
  gitStatus?: string | null;
  pyAppMd?: string | null;
  memoryMd?: string | null;
  readme?: string | null;
  projectName?: string;
}): Record<string, string> {
  const ctx: Record<string, string> = {};

  // 仅当项目名称存在时，将其加入上下文
  if (info.projectName) {
    ctx.projectName = info.projectName;
  }

  // 仅当 Git 状态信息存在时，将其加入上下文
  if (info.gitStatus) {
    ctx.gitStatus = info.gitStatus;
  }

  // 仅当 Python 应用 Markdown 内容存在时，将其加入上下文
  if (info.pyAppMd) {
    ctx.pyAppMd = info.pyAppMd;
  }

  // 仅当记忆 Markdown 内容存在时，将其加入上下文
  if (info.memoryMd) {
    ctx.memoryMd = info.memoryMd;
  }

  // 仅当 README 内容存在时，以 projectReadme 为键加入上下文
  if (info.readme) {
    ctx.projectReadme = info.readme;
  }

  return ctx;
}
