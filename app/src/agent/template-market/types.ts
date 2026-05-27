/**
 * Agent 模板市场类型定义
 */

/**
 * 模板分类
 */
export type TemplateCategory =
  | 'code-review'
  | 'test-writing'
  | 'exploration'
  | 'planning'
  | 'refactoring'
  | 'documentation'
  | 'debugging'
  | 'deployment'
  | 'monitoring'
  | 'custom';

/**
 * 模板来源
 */
export type TemplateSource = 'built-in' | 'community' | 'local' | 'custom';

/**
 * 模板元数据
 */
export interface TemplateMetadata {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板分类 */
  category: TemplateCategory;
  /** 模板来源 */
  source: TemplateSource;
  /** 作者 */
  author: string;
  /** 版本号 */
  version: string;
  /** 标签 */
  tags: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 下载次数 */
  downloadCount: number;
  /** 评分（1-5） */
  rating: number;
  /** 评分数 */
  ratingCount: number;
  /** 最低引擎版本 */
  minEngineVersion?: string;
  /** 图标（emoji） */
  icon?: string;
}

/**
 * 模板步骤定义
 */
export interface TemplateStep {
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description: string;
  /** Agent 类型 */
  agentType: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 执行模式 */
  mode?: 'sequential' | 'parallel';
  /** 错误处理策略 */
  onError?: 'abort' | 'skip' | 'retry';
  /** 子步骤 */
  substeps?: TemplateStep[];
}

/**
 * Agent 模板
 */
export interface AgentTemplate {
  /** 模板元数据 */
  metadata: TemplateMetadata;
  /** 模板步骤定义 */
  steps: TemplateStep[];
  /** 默认输入提示 */
  defaultInputHint?: string;
  /** 配置参数 */
  config?: Record<string, unknown>;
}

/**
 * 模板搜索过滤器
 */
export interface TemplateFilter {
  /** 分类 */
  category?: TemplateCategory;
  /** 来源 */
  source?: TemplateSource;
  /** 搜索关键词 */
  query?: string;
  /** 标签 */
  tags?: string[];
  /** 最低评分 */
  minRating?: number;
  /** 排序方式 */
  sortBy?: 'name' | 'rating' | 'downloads' | 'created' | 'updated';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
  /** 偏移量 */
  offset?: number;
  /** 限制条数 */
  limit?: number;
}

/**
 * 模板搜索结果
 */
export interface TemplateSearchResult {
  /** 模板列表 */
  templates: AgentTemplate[];
  /** 总数 */
  total: number;
  /** 偏移量 */
  offset: number;
  /** 限制 */
  limit: number;
}

/**
 * 模板安装配置
 */
export interface TemplateInstallConfig {
  /** 是否安装到全局 */
  global?: boolean;
  /** 安装后自动注册为链 */
  autoRegister?: boolean;
  /** 自定义名称 */
  customName?: string;
  /** 覆盖已有模板 */
  overwrite?: boolean;
}

/**
 * 模板安装结果
 */
export interface TemplateInstallResult {
  /** 是否成功 */
  success: boolean;
  /** 模板 ID */
  templateId: string;
  /** 安装路径 */
  installPath?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 模板评价
 */
export interface TemplateReview {
  /** 模板 ID */
  templateId: string;
  /** 用户 ID */
  userId: string;
  /** 评分（1-5） */
  rating: number;
  /** 评论文本 */
  comment?: string;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 本地模板仓库配置
 */
export interface LocalTemplateRepoConfig {
  /** 存储根目录 */
  baseDir: string;
  /** 最大缓存模板数 */
  maxCachedTemplates?: number;
  /** 自动同步间隔（毫秒） */
  syncIntervalMs?: number;
}
