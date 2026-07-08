/**
 * 技能预处理器
 * 对标 Hermes curator 的 preprocessing 能力
 * 支持模板变量替换（如 ${SKILL_DIR}）和内联 Shell 执行（如 !`command`）
 */
import path from 'path';
import { execSync } from 'node:child_process';
import { configManager } from '@modules/config';

/**
 * 预处理选项
 */
export interface PreprocessOptions {
  skillDir: string;
  workspaceDir?: string;
  variables?: Record<string, string>;
  enableShellExecution: boolean;
  shellTimeoutMs: number;
}

/**
 * 默认预处理选项
 */
export const DEFAULT_PREPROCESS_OPTIONS: PreprocessOptions = {
  skillDir: '',
  enableShellExecution: false,
  shellTimeoutMs: 5000,
};

/**
 * 技能预处理器
 */
export class SkillPreprocessor {
  private options: PreprocessOptions;

  /**
   * 构造函数
   * @param options 预处理选项
   */
  constructor(options?: Partial<PreprocessOptions>) {
    this.options = { ...DEFAULT_PREPROCESS_OPTIONS, ...options };
  }

  /**
   * 设置技能根目录
   * @param dir 目录路径
   */
  setSkillDir(dir: string): void {
    this.options.skillDir = dir;
  }

  /**
   * 设置工作区目录
   * @param dir 目录路径
   */
  setWorkspaceDir(dir: string): void {
    this.options.workspaceDir = dir;
  }

  /**
   * 设置自定义变量
   * @param key 变量名
   * @param value 变量值
   */
  setVariable(key: string, value: string): void {
    if (!this.options.variables) {
      this.options.variables = {};
    }
    this.options.variables[key] = value;
  }

  /**
   * 预处理技能内容
   * @param content 原始技能内容
   * @returns 预处理后的内容
   */
  preprocess(content: string): string {
    let processed = content;

    processed = this.resolveTemplateVariables(processed);
    processed = this.resolveInlineShell(processed);

    return processed;
  }

  /**
   * 解析模板变量
   * 支持 ${VARIABLE_NAME} 和 $VARIABLE_NAME 格式
   * @param content 原始内容
   * @returns 替换后的内容
   */
  private resolveTemplateVariables(content: string): string {
    let result = content;

    result = result.replace(/\$\{SKILL_DIR\}/g, this.options.skillDir);
    result = result.replace(
      /\$\{WORKSPACE_DIR\}/g,
      this.options.workspaceDir || process.cwd()
    );
    result = result.replace(
      /\$\{HOME\}/g,
      configManager.env('HOME') || configManager.env('USERPROFILE') || ''
    );
    result = result.replace(
      /\$\{TMPDIR\}/g,
      configManager.env('TMPDIR') || configManager.env('TEMP') || '/tmp'
    );
    result = result.replace(/\$\{CWD\}/g, process.cwd());
    result = result.replace(/\$\{OS\}/g, process.platform);
    result = result.replace(/\$\{ARCH\}/g, process.arch);

    if (this.options.variables) {
      for (const [key, value] of Object.entries(this.options.variables)) {
        const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
        result = result.replace(pattern, value);
      }
    }

    return result;
  }

  /**
   * 解析内联 Shell 执行
   * 支持 !`command` 格式
   * @param content 原始内容
   * @returns 替换后的内容
   */
  private resolveInlineShell(content: string): string {
    if (!this.options.enableShellExecution) {
      return content;
    }

    const shellPattern = /!`([^`]+)`/g;

    return content.replace(shellPattern, (_match, command: string) => {
      try {
        const output = execSync(command.trim(), {
          timeout: this.options.shellTimeoutMs,
          encoding: 'utf-8',
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
        });

        return output.trim();
      } catch {
        return `[SHELL_ERROR: ${command.trim()}]`;
      }
    });
  }

  /**
   * 预处理技能文件内容（含 YAML front matter 去除）
   * @param content 带 front matter 的技能文件内容
   * @returns 预处理后的内容
   */
  preprocessSkillFile(content: string): string {
    let body = content;

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (fmMatch) {
      body = content.slice(fmMatch[0].length);
    }

    return this.preprocess(body);
  }

  /**
   * 提取 YAML front matter
   * @param content 技能文件内容
   * @returns front matter 对象和剩余内容
   */
  extractFrontmatter(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);

    if (!fmMatch) {
      return { frontmatter: {}, body: content };
    }

    const frontmatter: Record<string, unknown> = {};
    const fmContent = fmMatch[1];
    const lines = fmContent.split('\n');

    for (const line of lines) {
      const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value: unknown = kvMatch[2].trim();

        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value as string))
          value = parseInt(value as string, 10);
        else if (
          (value as string).startsWith('[') &&
          (value as string).endsWith(']')
        ) {
          value = (value as string)
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim());
        }

        frontmatter[key] = value;
      }
    }

    const body = content.slice(fmMatch[0].length);

    return { frontmatter, body };
  }
}

/**
 * 全局预处理器实例
 */
let globalPreprocessor: SkillPreprocessor | null = null;

/**
 * 获取全局技能预处理器
 * @returns SkillPreprocessor 实例
 */
export function getSkillPreprocessor(
  options?: Partial<PreprocessOptions>
): SkillPreprocessor {
  if (!globalPreprocessor) {
    globalPreprocessor = new SkillPreprocessor(options);
  }

  return globalPreprocessor;
}

/**
 * 重置全局预处理器
 */
export function resetSkillPreprocessor(): void {
  globalPreprocessor = null;
}
