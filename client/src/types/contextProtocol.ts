/**
 * 三层上下文传递协议
 *
 * 定义 Agent 三层上下文的加载和传递规范：
 * - Layer 1: 规则注入（.liri/rules.md + 项目级规则）
 * - Layer 2: 知识注入（.liri/knowledge.json + 经验记忆）
 * - Layer 3: 工具注入（.liri/tools.json + 工作空间配置）
 *
 * 规则在 Layer 1 注入，确保 AI 在执行任何操作前先加载规则约束。
 */

// ========== 上下文层定义 ==========

/** 上下文层标识 */
export type ContextLayer = 1 | 2 | 3;

/** 上下文层元数据 */
export interface ContextLayerMeta {
  /** 层编号 */
  layer: ContextLayer;
  /** 层名称 */
  name: string;
  /** 层描述 */
  description: string;
  /** 加载优先级（数字越小越先加载） */
  priority: number;
  /** 是否必须加载 */
  required: boolean;
}

/** 三层上下文层定义 */
export const CONTEXT_LAYERS: Record<ContextLayer, ContextLayerMeta> = {
  1: {
    layer: 1,
    name: "规则层",
    description: "工作空间规则 + 项目级规则，约束 AI 行为边界",
    priority: 1,
    required: true,
  },
  2: {
    layer: 2,
    name: "知识层",
    description: "知识库 + 经验记忆，提供领域上下文",
    priority: 2,
    required: false,
  },
  3: {
    layer: 3,
    name: "工具层",
    description: "工具配置 + 模型绑定，提供执行能力",
    priority: 3,
    required: true,
  },
};

// ========== 规则注入（Layer 1） ==========

/** 规则条目 */
export interface RuleEntry {
  /** 规则 ID（如 CS01-001） */
  id: string;
  /** 规则描述 */
  description: string;
  /** 规则级别 */
  level: "MUST" | "SHOULD" | "MAY";
  /** 规则来源 */
  source: "workspace" | "project" | "system";
  /** 规则内容 */
  content: string;
}

/** 规则注入上下文 */
export interface RuleInjectionContext {
  /** 工作空间规则 */
  workspaceRules: RuleEntry[];
  /** 项目级规则 */
  projectRules: RuleEntry[];
  /** 系统级规则 */
  systemRules: RuleEntry[];
  /** 合并后的完整规则文本 */
  mergedRules: string;
  /** 注入时间 */
  injectedAt: string;
}

// ========== 知识注入（Layer 2） ==========

/** 知识条目 */
export interface KnowledgeEntry {
  /** 知识 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 内容 */
  content: string;
  /** 来源 */
  source: string;
  /** 相关标签 */
  tags: string[];
  /** 创建时间 */
  createdAt: string;
}

/** 知识注入上下文 */
export interface KnowledgeInjectionContext {
  /** 知识库条目 */
  knowledgeEntries: KnowledgeEntry[];
  /** 经验记忆条目 */
  memoryEntries: Array<{
    workItemId: string;
    summary: string;
    createdAt: string;
  }>;
  /** 注入时间 */
  injectedAt: string;
}

// ========== 工具注入（Layer 3） ==========

/** 工具定义 */
export interface ToolDefinition {
  /** 工具 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
  /** 工具分类 */
  category: string;
}

/** 工具注入上下文 */
export interface ToolInjectionContext {
  /** 启用的工具列表 */
  tools: ToolDefinition[];
  /** 禁用的工具列表 */
  disabledTools: string[];
  /** 模型绑定 */
  modelBindings: Array<{
    agentRole: string;
    model: string;
    maxTokens: number;
    temperature: number;
  }>;
  /** 注入时间 */
  injectedAt: string;
}

// ========== 完整上下文传递 ==========

/** 三层上下文聚合 */
export interface AggregatedContext {
  /** 工作项 ID */
  workItemId: string;
  /** 工作空间 ID */
  workspaceId: string;
  /** Layer 1: 规则 */
  rules: RuleInjectionContext;
  /** Layer 2: 知识 */
  knowledge: KnowledgeInjectionContext;
  /** Layer 3: 工具 */
  tools: ToolInjectionContext;
  /** 构建时间 */
  builtAt: string;
}

// ========== Rule Check Gate ==========

/** 规则检查结果 */
export interface RuleCheckResult {
  /** 检查的规则 ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 是否通过 */
  passed: boolean;
  /** 是否需要人工审核 */
  needsReview: boolean;
  /** 检查的文件 */
  filePath?: string;
  /** 违规行号 */
  lineNumber?: number;
  /** 检查结果消息 */
  message: string;
  /** 检查时间 */
  checkedAt: string;
}

/** Rule Check Gate 状态 */
export interface RuleCheckGateState {
  /** 工作项 ID */
  workItemId: string;
  /** 检查状态 */
  status: "idle" | "checking" | "passed" | "failed" | "review_required";
  /** 检查结果列表 */
  results: RuleCheckResult[];
  /** 通过数 */
  passedCount: number;
  /** 失败数 */
  failedCount: number;
  /** 需审核数 */
  reviewCount: number;
  /** 开始时间 */
  startedAt: string;
  /** 完成时间 */
  completedAt?: string;
}

/**
 * 构建三层聚合上下文
 * 从 .liri/ 配置中加载所有层的数据
 */
export function buildAggregatedContext(
  workItemId: string,
  workspaceId: string,
  workspaceRules: string,
  projectRules: string,
  knowledgeEntries: KnowledgeEntry[],
  memoryEntries: Array<{ workItemId: string; summary: string; createdAt: string }>,
  tools: ToolDefinition[],
  modelBindings: Array<{ agentRole: string; model: string; maxTokens: number; temperature: number }>
): AggregatedContext {
  const now = new Date().toISOString();

  return {
    workItemId,
    workspaceId,
    rules: {
      workspaceRules: parseRules(workspaceRules, "workspace"),
      projectRules: parseRules(projectRules, "project"),
      systemRules: [],
      mergedRules: [workspaceRules, projectRules].filter(Boolean).join("\n\n"),
      injectedAt: now,
    },
    knowledge: {
      knowledgeEntries,
      memoryEntries,
      injectedAt: now,
    },
    tools: {
      tools,
      disabledTools: [],
      modelBindings,
      injectedAt: now,
    },
    builtAt: now,
  };
}

/**
 * 解析规则文本为规则条目
 */
function parseRules(content: string, source: "workspace" | "project" | "system"): RuleEntry[] {
  if (!content) return [];

  const entries: RuleEntry[] = [];
  const lines = content.split("\n");
  let currentEntry: Partial<RuleEntry> | null = null;

  for (const line of lines) {
    // 匹配规则 ID 行：`[CS-ID] [级别] 描述`
    const match = line.match(/^\[([A-Z]+-\d+)\]\s*\[(MUST|SHOULD|MAY)\]\s*(.+)$/);
    if (match) {
      if (currentEntry?.id) {
        entries.push(currentEntry as RuleEntry);
      }
      currentEntry = {
        id: match[1],
        level: match[2] as "MUST" | "SHOULD" | "MAY",
        description: match[3],
        source,
        content: line,
      };
    } else if (currentEntry) {
      currentEntry.content = (currentEntry.content || "") + "\n" + line;
    }
  }

  if (currentEntry?.id) {
    entries.push(currentEntry as RuleEntry);
  }

  return entries;
}