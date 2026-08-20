/**
 * 分阶段文档工作流类型定义（设计方案 §4.2）
 *
 * DocOutline：阶段①大纲整理的产出物
 * FilledOutline：阶段②内容填充后的产出物
 * OutlinePatch：大纲变更增量更新（设计方案 §4.4 v0.4 新增）
 */

// ─── 文档格式 ──────────────────────────────────────────

export type DocFormat = 'docx' | 'pptx' | 'html' | 'pdf';

// ─── 大纲节点 ──────────────────────────────────────────

/**
 * 大纲节点：文档的最小结构单元（设计方案 §4.2）
 */
export interface DocOutlineNode {
  /** 节点 ID（如 "sec-1-2"） */
  id: string;
  /** 节点类型（文档格式相关） */
  kind: 'section' | 'slide' | 'chart' | 'text';
  /** 标题（PPT：≤6 字，可配置） */
  title: string;
  /** 要点列表（PPT：≤3 条，可配置） */
  bullets?: string[];
  /** 配图意图描述（非空则触发图片生成） */
  imageHint?: string;
  /** 子节点 */
  children?: DocOutlineNode[];
  /** 图片占位符（阶段②③使用，见 §4.3） */
  placeholder?: string;
  /** 阶段②填充的正文内容 */
  content?: string;
  /** 阶段②生成图片后的文件路径 */
  imageFilePath?: string;
}

// ─── 完整大纲 ──────────────────────────────────────────

/**
 * 完整大纲：阶段①的产出物（设计方案 §4.2）
 */
export interface DocOutline {
  /** 输出格式 */
  format: DocFormat;
  /** 文档标题 */
  title: string;
  /** 大纲节点列表 */
  nodes: DocOutlineNode[];
  /** 创建时间戳 */
  createdAt: number;
  /** PPT 精炼配置（仅 format=pptx 时有效，设计方案 §4.6 v0.4） */
  pptConfig?: PptRefineConfig;
}

// ─── 填充后大纲 ────────────────────────────────────────

/**
 * 阶段②内容填充后的产出物
 */
export interface FilledOutline extends DocOutline {
  /** 所有节点均已填充 content（阶段②完成标记） */
  filledAt: number;
  /** 图片生成缓存：placeholder id → filePath（按 id 去重复用） */
  imageCache: Map<string, string>;
  /** 填充失败的节点 ID 列表（降级：保留占位符，人工插图） */
  failedNodes: string[];
}

// ─── 大纲变更补丁 ──────────────────────────────────────

/**
 * 大纲变更增量更新（设计方案 §4.4 v0.4 新增）
 */
export interface OutlinePatch {
  type: 'added' | 'removed' | 'modified';
  nodeId: string;
  /** added/modified 时携带新节点数据 */
  node?: DocOutlineNode;
}

// ─── PPT 精炼配置 ──────────────────────────────────────

/**
 * PPT 精炼规则配置（设计方案 §4.6 v0.4 可配置边界）
 */
export interface PptRefineConfig {
  /** 标题字数上限（范围 4-8，默认 6） */
  maxTitleLength: number;
  /** 要点条数上限（范围 2-4，默认 3） */
  maxBullets: number;
  /** 配图意图强制标注开关（默认 true） */
  enforceImageHint: boolean;
}

/** 默认 PPT 精炼配置 */
export const DEFAULT_PPT_CONFIG: PptRefineConfig = {
  maxTitleLength: 6,
  maxBullets: 3,
  enforceImageHint: true,
};

/**
 * 校验 PPT 精炼配置合法性（min/max 边界保护）
 */
export function validatePptConfig(
  config: Partial<PptRefineConfig>
): PptRefineConfig {
  return {
    maxTitleLength: clamp(config.maxTitleLength ?? 6, 4, 8),
    maxBullets: clamp(config.maxBullets ?? 3, 2, 4),
    enforceImageHint: config.enforceImageHint ?? true,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ─── 占位符协议类型 ────────────────────────────────────

/**
 * 图片占位符解析结果（设计方案 §4.3 v0.4 增强）
 *
 * 格式：![图片描述](GENERATE:id=img-1;prompt=提示词)
 */
export interface ImagePlaceholder {
  /** 原始 Markdown 占位符文本 */
  raw: string;
  /** 图片描述（alt text） */
  description: string;
  /** 占位符 ID（同 id 图片只生成一次，多节点复用） */
  id: string;
  /** 图片生成提示词 */
  prompt: string;
}

// ─── 工作流进度数据（SSE 推送） ────────────────────────

export type DocWorkflowStage = 'outline' | 'filling' | 'compose';
export type DocWorkflowStageStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_confirm'
  | 'completed'
  | 'failed';

export interface DocWorkflowStageData {
  status: DocWorkflowStageStatus;
  progress?: number;
  description?: string;
  nodes?: DocWorkflowNodeProgress[];
}

export interface DocWorkflowNodeProgress {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  hasImage?: boolean;
}

/**
 * 文档工作流进度数据（SSE 推送到前端）
 * 与前端 DocWorkflowProgressData 对齐
 */
export interface DocWorkflowProgressData {
  title: string;
  format: DocFormat;
  currentStage: DocWorkflowStage;
  stages: Record<DocWorkflowStage, DocWorkflowStageData>;
  outputFilePath?: string;
  error?: string;
}
