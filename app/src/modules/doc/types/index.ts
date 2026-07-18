/**
 * doc 模块类型定义
 */

/** OfficeCLI 检测结果 */
export interface OfficeCLIInfo {
  installed: boolean;
  version?: string;
  path?: string;
}

/** OfficeCLI 版本约束 */
export interface OfficeCLIVersionConstraint {
  minVersion: string;
  maxVersion: string;
  knownIncompatible: string[];
  lastTested: string;
}

/** doc 模块状态枚举 */
export enum DocModuleStatus {
  /** 未初始化 */
  UNINITIALIZED = 'uninitialized',
  /** 完整模式：OfficeCLI 已安装，读写可用 */
  FULL = 'full',
  /** 降级模式：OfficeCLI 不可用，仅文件读取可用 */
  DEGRADED = 'degraded',
  /** 已关闭 */
  SHUTDOWN = 'shutdown',
}

/** 文档能力报告 */
export interface DocCapabilityReport {
  status: DocModuleStatus;
  officeCliInfo: OfficeCLIInfo;
  connectedCount: number;
  toolCount: number;
  templateCount: number;
  /** 已注册的模板名称列表（用于前端展示） */
  templates: string[];
  /** 输出目录中的文档文件列表 */
  documents: { name: string; size: number; mtime: number }[];
}

/** MCP 请求类型 */
export type MCPRequestType = 'read' | 'write' | 'render';

/** MCP 请求 */
export interface MCPRequest {
  id: string;
  type: MCPRequestType;
  command: string;
  createdAt: number;
}

/** MCP 响应 */
export interface MCPResponse {
  requestId: string;
  success: boolean;
  data?: string;
  error?: string;
  duration: number;
}

/** 文档引用图节点 */
export interface DocumentNode {
  path: string;
  references: string[];
}

/** 审计日志条目 */
export interface AuditEntry {
  timestamp: string;
  user: string;
  operation: string;
  target: string;
  result: 'success' | 'fail';
  detail?: string;
}

/** 资源限制配置 */
export interface ResourceLimits {
  maxMemoryMB: number;
  maxOutputSizeMB: number;
  maxDiskUsageMB: number;
}
