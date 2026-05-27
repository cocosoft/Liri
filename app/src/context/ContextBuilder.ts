/**
 * 动态上下文构建器
 * 整合Git/项目文件/系统信息，构建动态系统提示词
 * 使用memoize进行缓存优化，支持缓存破坏机制
 */
import * as path from 'path';
import { getGitInfo, type GitInfo } from './GitDetector';
import {
  readProjectFiles,
  readUserPyAppMd,
  type ProjectFiles,
} from './ProjectFileReader';
import {
  buildBasePrompt,
  buildUserContext,
  buildSystemContext,
  type SystemPromptParts,
} from './PromptTemplates';
import { getPromptInjectionDetector } from '../security/injection/PromptInjectionDetector';
import { getUnicodeSanitizer } from '../security/injection/UnicodeSanitizer';

/**
 * 简单的 memoize 实现，用于缓存函数调用的结果以避免重复计算。
 * 此实现旨在避免引入 lodash-es 的类型依赖。
 *
 * @template T - 被记忆化的函数类型，必须是一个接受任意参数并返回任意值的函数。
 * @param fn - 需要进行记忆化处理的原始函数。
 * @param resolver - 一个解析函数，用于根据传入的参数生成唯一的缓存键（字符串）。
 *                   该函数的参数类型与原始函数 fn 的参数类型一致。
 * @returns 返回一个新的函数，该函数具有与原始函数相同的签名。
 *          当使用相同的参数调用时，它将返回缓存的结果，而不是重新执行原始函数。
 */
function memoize<T extends (...args: any[]) => any>(
  fn: T,
  resolver: (...args: Parameters<T>) => string
): T {
  // 创建用于存储缓存结果的 Map，键为字符串，值为函数的返回类型
  const cache = new Map<string, ReturnType<T>>();

  // 创建记忆化后的函数包装器
  const memoized = ((...args: any[]) => {
    // 使用 resolver 生成当前参数的唯一缓存键
    const key = resolver(...(args as Parameters<T>));

    // 如果缓存中不存在该键对应的结果，则执行原始函数并存储结果
    if (!cache.has(key)) {
      cache.set(key, fn(...args));
    }

    // 从缓存中获取并返回结果（断言非空，因为上一步已确保存在）
    return cache.get(key)!;
  }) as T;

  return memoized;
}

export class ContextBuilder {
  private cwd: string;
  private gitInfo: GitInfo | null = null;
  private projectFiles: ProjectFiles | null = null;
  private cacheBuster: number = 0;

  private getUserContextMemoized: (
    cwd: string,
    branch: string | null,
    cacheBuster: number
  ) => Promise<Record<string, string>>;
  private getSystemContextMemoized: (
    cwd: string,
    gitStatus: string | null,
    pyAppMd: string,
    memoryMd: string | undefined,
    readme: string | undefined,
    cacheBuster: number
  ) => Promise<Record<string, string>>;
  private buildSystemPromptMemoized: (
    toolNames: string[],
    cwd: string,
    cacheBuster: number
  ) => Promise<SystemPromptParts>;

  /**
   * 初始化上下文构建器实例。
   *
   * @param cwd - 可选的工作目录路径。如果未提供，则默认使用当前进程的工作目录。
   */
  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();

    // 创建带缓存的用户上下文获取函数，缓存键基于工作目录、分支和缓存破坏者
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

    // 创建带缓存的系统上下文获取函数，缓存键基于工作目录、Git状态及各文档内容的长度
    this.getSystemContextMemoized = memoize(
      async (
        cwd: string,
        gitStatus: string | null,
        pyAppMd: string,
        memoryMd: string | undefined,
        readme: string | undefined,
        _cacheBuster: number
      ) => {
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

    // 创建带缓存的系统提示词构建函数，包含文件读取、安全 sanitization 及上下文组装逻辑
    this.buildSystemPromptMemoized = memoize(
      async (toolNames: string[], cwd: string, _cacheBuster: number) => {
        const basePrompt = buildBasePrompt(toolNames);
        const gitInfo = await getGitInfo(cwd);
        const projectFiles = readProjectFiles(cwd);
        const userPyAppMd = readUserPyAppMd();

        const unicodeSanitizer = getUnicodeSanitizer();
        const injectionDetector = getPromptInjectionDetector();

        // 合并项目自带的 pyAppMd 和用户自定义的 pyAppMd
        let combinedPyAppMd = projectFiles?.pyAppMd || '';
        if (userPyAppMd) {
          combinedPyAppMd = combinedPyAppMd
            ? `${combinedPyAppMd}\n\n---\n\n${userPyAppMd}`
            : userPyAppMd;
        }

        // 对合并后的 pyAppMd 进行 Unicode 清洗和注入攻击检测
        if (combinedPyAppMd) {
          combinedPyAppMd = unicodeSanitizer.sanitize(combinedPyAppMd).output;

          const detectResult = injectionDetector.detect(combinedPyAppMd);
          if (detectResult.severity === 'critical') {
            combinedPyAppMd = '[⚠ 上下文文件包含可疑注入内容，已移除]';
          }
        }

        // 对 memoryMd 进行 Unicode 清洗以确保安全
        let safeMemoryMd = projectFiles?.memoryMd;
        if (safeMemoryMd) {
          safeMemoryMd = unicodeSanitizer.sanitize(safeMemoryMd).output;
        }

        const userContext = buildUserContext({
          platform: process.platform,
          cwd,
          branch: gitInfo?.branch,
        });

        const systemContext = buildSystemContext({
          gitStatus: gitInfo?.status,
          pyAppMd: combinedPyAppMd || undefined,
          memoryMd: safeMemoryMd || undefined,
          readme: projectFiles?.readme || undefined,
          projectName: path.basename(cwd),
        });

        return { basePrompt, userContext, systemContext };
      },
      (toolNames, cwd, cacheBuster) =>
        `${toolNames.join(',')}:${cwd}:${cacheBuster}`
    );
  }

  /**
   * 初始化当前实例，获取 Git 信息并读取项目文件。
   */
  async initialize(): Promise<void> {
    // 获取当前工作目录的 Git 信息
    this.gitInfo = await getGitInfo(this.cwd);
    // 读取当前工作目录下的项目文件列表
    this.projectFiles = readProjectFiles(this.cwd);
  }

  /**
   * 获取 Git 信息。
   *
   * @returns {GitInfo | null} 返回当前的 Git 信息对象，如果未设置则返回 null。
   */
  getGitInfo(): GitInfo | null {
    return this.gitInfo;
  }

  /**
   * 获取项目文件信息。
   *
   * @returns 返回当前的项目文件对象，如果不存在则返回 null。
   */
  getProjectFiles(): ProjectFiles | null {
    return this.projectFiles;
  }

  /**
   * 获取用户上下文信息。
   * 如果 git 信息尚未初始化，则先执行初始化操作。
   * 最终返回基于当前工作目录、Git 分支和缓存失效器的 memoized 用户上下文。
   *
   * @returns 包含用户上下文键值对的记录对象，键和值均为字符串类型。
   */
  async getUserContext(): Promise<Record<string, string>> {
    // 确保 git 信息已初始化
    if (!this.gitInfo) await this.initialize();
    return this.getUserContextMemoized(
      this.cwd,
      this.gitInfo?.branch || null,
      this.cacheBuster
    );
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
      this.projectFiles?.memoryMd ?? undefined,
      this.projectFiles?.readme ?? undefined,
      this.cacheBuster
    );
  }

  /**
   * 构建系统提示词
   * @deprecated 功能已迁移至 systemPromptSections（gitContext/projectMeta 段落）。
   *             请使用 PromptAssembler.assembleSystemPrompt() 替代。
   */
  async buildSystemPrompt(
    toolNames: string[] = []
  ): Promise<SystemPromptParts> {
    return this.buildSystemPromptMemoized(
      toolNames,
      this.cwd,
      this.cacheBuster
    );
  }

  /**
   * 根据模型名称获取其对应的上下文窗口大小。
   *
   * @param model - 模型名称字符串，用于判断是否包含特定标识以确定上下文窗口大小。
   * @returns 返回模型的上下文窗口大小（token 数量）。如果模型名称包含 '[1m]'，则返回 1,000,000；否则返回默认值 200,000。
   */
  getContextWindowForModel(model: string): number {
    const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;

    // 检查模型名称是否包含 '[1m]' 标识，若是则返回 1,000,000 的上下文窗口大小
    if (model.includes('[1m]')) {
      return 1_000_000;
    }

    return MODEL_CONTEXT_WINDOW_DEFAULT;
  }

  /**
   * 清除内部缓存状态。
   *
   * 该函数会重置 Git 信息和项目文件缓存，并通过递增缓存破坏者（cache buster）来确保后续数据获取的最新性。
   */
  clearCache(): void {
    this.gitInfo = null;
    this.projectFiles = null;
    this.cacheBuster++;
  }

  /**
   * 使缓存失效。
   * 通过递增 cacheBuster 的值来强制刷新缓存。
   */
  invalidateCache(): void {
    this.cacheBuster++;
  }
}

let defaultBuilder: ContextBuilder | null = null;

/**
 * 获取默认 ContextBuilder 实例
 * @deprecated ContextBuilder 的提示词构造功能已迁移至 systemPromptSections。
 *             如需读取 Git 信息或项目文件，请直接使用 GitDetector / ProjectFileReader。
 */
export function getContextBuilder(cwd?: string): ContextBuilder {
  if (!defaultBuilder || cwd) {
    defaultBuilder = new ContextBuilder(cwd);
  }
  return defaultBuilder;
}
