//
/**
 * 动态上下文构建器（参考CC源码 context.ts）
 * 整合Git/项目文件/系统信息，构建动态系统提示词
 * 使用memoize进行缓存优化，支持缓存破坏机制
 */
import * as path from 'path';
import { memoize } from 'lodash-es';
import { getGitInfo, type GitInfo } from './GitDetector';
import { readProjectFiles, readUserPyAppMd, type ProjectFiles } from './ProjectFileReader';
import {
  buildBasePrompt,
  buildUserContext,
  buildSystemContext,
  type SystemPromptParts,
} from './PromptTemplates';

export class ContextBuilder {
  private cwd: string;
  private gitInfo: GitInfo | null = null;
  private projectFiles: ProjectFiles | null = null;
  private cacheBuster: number = 0;

  private getUserContextMemoized: (cwd: string, branch: string | null, cacheBuster: number) => Promise<Record<string, string>>;
  private getSystemContextMemoized: (cwd: string, gitStatus: string | null, pyAppMd: string, memoryMd: string | undefined, readme: string | undefined, cacheBuster: number) => Promise<Record<string, string>>;
  private buildSystemPromptMemoized: (toolNames: string[], cwd: string, cacheBuster: number) => Promise<SystemPromptParts>;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    
    this.getUserContextMemoized = memoize(
      async (cwd: string, branch: string | null, _cacheBuster: number) => {
        return buildUserContext({
          platform: process.platform,
          cwd,
          branch,
        });
      },
      (cwd, branch, cacheBuster) => `${cwd}:${branch}:${cacheBuster}`
    );

    this.getSystemContextMemoized = memoize(
      async (cwd: string, gitStatus: string | null, pyAppMd: string, memoryMd: string | undefined, readme: string | undefined, _cacheBuster: number) => {
        const projectName = path.basename(cwd);
        return buildSystemContext({
          gitStatus,
          pyAppMd: pyAppMd || undefined,
          memoryMd,
          readme,
          projectName,
        });
      },
      (cwd, gitStatus, pyAppMd, memoryMd, readme, cacheBuster) => 
        `${cwd}:${gitStatus}:${pyAppMd.length}:${memoryMd?.length || 0}:${readme?.length || 0}:${cacheBuster}`
    );

    this.buildSystemPromptMemoized = memoize(
      async (toolNames: string[], cwd: string, _cacheBuster: number) => {
        const basePrompt = buildBasePrompt(toolNames);
        const gitInfo = await getGitInfo(cwd);
        const projectFiles = readProjectFiles(cwd);
        const userPyAppMd = readUserPyAppMd();

        let combinedPyAppMd = projectFiles?.pyAppMd || '';
        if (userPyAppMd) {
          combinedPyAppMd = combinedPyAppMd
            ? `${combinedPyAppMd}\n\n---\n\n${userPyAppMd}`
            : userPyAppMd;
        }

        const userContext = buildUserContext({
          platform: process.platform,
          cwd,
          branch: gitInfo?.branch,
        });

        const systemContext = buildSystemContext({
          gitStatus: gitInfo?.status,
          pyAppMd: combinedPyAppMd || undefined,
          memoryMd: projectFiles?.memoryMd || undefined,
          readme: projectFiles?.readme || undefined,
          projectName: path.basename(cwd),
        });

        return { basePrompt, userContext, systemContext };
      },
      (toolNames, cwd, cacheBuster) => `${toolNames.join(',')}:${cwd}:${cacheBuster}`
    );
  }

  async initialize(): Promise<void> {
    this.gitInfo = await getGitInfo(this.cwd);
    this.projectFiles = readProjectFiles(this.cwd);
  }

  getGitInfo(): GitInfo | null {
    return this.gitInfo;
  }

  getProjectFiles(): ProjectFiles | null {
    return this.projectFiles;
  }

  async getUserContext(): Promise<Record<string, string>> {
    if (!this.gitInfo) await this.initialize();
    return this.getUserContextMemoized(this.cwd, this.gitInfo?.branch || null, this.cacheBuster);
  }

  async getSystemContext(): Promise<Record<string, string>> {
    if (!this.gitInfo) await this.initialize();

    const userPyAppMd = readUserPyAppMd();
    let combinedPyAppMd = this.projectFiles?.pyAppMd || '';
    if (userPyAppMd) {
      combinedPyAppMd = combinedPyAppMd
        ? `${combinedPyAppMd}\n\n---\n\n${userPyAppMd}`
        : userPyAppMd;
    }

    return this.getSystemContextMemoized(
      this.cwd,
      this.gitInfo?.status || null,
      combinedPyAppMd,
      this.projectFiles?.memoryMd,
      this.projectFiles?.readme,
      this.cacheBuster
    );
  }

  async buildSystemPrompt(toolNames: string[] = []): Promise<SystemPromptParts> {
    return this.buildSystemPromptMemoized(toolNames, this.cwd, this.cacheBuster);
  }

  getContextWindowForModel(model: string): number {
    const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;

    if (model.includes('[1m]')) {
      return 1_000_000;
    }

    return MODEL_CONTEXT_WINDOW_DEFAULT;
  }

  clearCache(): void {
    this.gitInfo = null;
    this.projectFiles = null;
    this.cacheBuster++;
  }

  invalidateCache(): void {
    this.cacheBuster++;
  }
}

let defaultBuilder: ContextBuilder | null = null;

export function getContextBuilder(cwd?: string): ContextBuilder {
  if (!defaultBuilder || cwd) {
    defaultBuilder = new ContextBuilder(cwd);
  }
  return defaultBuilder;
}
