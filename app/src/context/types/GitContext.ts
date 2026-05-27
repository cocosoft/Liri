/**
 * GitContext类型定义
 * 包含Git仓库状态信息
 *
 * 参考CC源码实现: cc_code/backend/utils/git.ts
 */

import type { Context } from './Context.js';

/**
 * Git仓库状态
 */
export type GitRepoStatus = 'clean' | 'dirty' | 'unknown';

/**
 * GitChangeType文件变更类型
 */
export type GitChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unknown';

/**
 * Git文件状态
 */
export interface GitFileStatus {
  path: string;
  status: GitChangeType;
}

/**
 * Git提交信息
 */
export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authorEmail: string;
  date: Date;
}

/**
 * GitContext接口
 * 描述Git仓库的完整状态
 */
export interface GitContext extends Context {
  type: 'git';

  /** 仓库根目录路径 */
  rootPath: string;

  /** 当前分支 */
  branch: string;

  /** 主分支（通常用于PR） */
  mainBranch: string;

  /** 仓库状态 */
  status: GitRepoStatus;

  /** 文件状态列表 */
  fileStatuses: GitFileStatus[];

  /** 简短状态字符串 */
  shortStatus?: string;

  /** 完整状态字符串 */
  fullStatus?: string;

  /** 最近提交列表 */
  recentCommits: GitCommitInfo[];

  /** 当前用户 */
  userName?: string;

  /** 当前用户邮箱 */
  userEmail?: string;

  /** 远程仓库URL */
  remoteUrl?: string;

  /** 标签列表 */
  tags: string[];

  /** 子模块列表 */
  submodules: string[];

  /** 差异统计 */
  diffStats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

/**
 * 创建默认GitContext
 * @param rootPath 仓库根目录
 * @returns 默认GitContext
 */
export function createDefaultGitContext(rootPath: string): GitContext {
  return {
    type: 'git',
    rootPath,
    branch: '',
    mainBranch: 'main',
    status: 'unknown',
    fileStatuses: [],
    recentCommits: [],
    tags: [],
    submodules: [],
    createdAt: new Date(),
  };
}

export default GitContext;
