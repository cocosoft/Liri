/**
 * 工作空间元数据
 * 存储在每个工作空间目录下的 .workspace.json 中
 */
export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  description: string;
}

/**
 * 工作空间条目
 * 用于列表展示，合并元数据与运行时统计
 */
export interface WorkspaceEntry {
  name: string;
  path: string;
  meta: WorkspaceMeta;
  fileCount: number;
  isActive: boolean;
}

/**
 * 工作空间注册表
 * 存储于 ~/.pyapp/workspaces.json
 */
export interface WorkspaceRegistry {
  workspaces: Record<string, string>;
  defaultRoot: string;
  activeWorkspace: string | null;
}
