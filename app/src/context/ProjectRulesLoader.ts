/**
 * 项目规则文件加载器（解析 .md 指令文件）
 * 支持多目录发现、@include 指令、Frontmatter 解析、HTML注释剥离
 * 文件加载顺序（优先级从低到高）：
 *   1. Managed（系统级全局指令）
 *   2. User（用户级全局指令）
 *   3. Project（项目级指令，已检入代码库）
 *   4. Local（项目级本地指令，未检入）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import {
  join,
  dirname,
  basename,
  extname,
  isAbsolute,
  resolve,
  normalize,
} from 'path';
import { homedir } from 'os';
import { parseFrontmatter } from '@modules/utils/frontmatterParser';
import { configManager } from '@modules/config';

const MAX_MEMORY_CHARACTER_COUNT = 40000;
const MAX_INCLUDE_DEPTH = 5;

const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.text',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.sql',
  '.graphql',
  '.vue',
  '.svelte',
  '.php',
  '.lua',
  '.dart',
  '.swift',
]);

/**
 * 记忆类型
 */
export type MemoryType =
  | 'Managed'
  | 'User'
  | 'Project'
  | 'Local'
  | 'AutoMem'
  | 'TeamMem';

/**
 * 记忆文件信息
 */
export interface MemoryFileInfo {
  path: string;
  type: MemoryType;
  content: string;
  parent?: string;
  globs?: string[];
  contentDiffersFromDisk?: boolean;
  rawContent?: string;
}

/**
 * 项目规则接口（从 Markdown 文件解析的行为准则、编码标准等）
 */
export interface ProjectRules {
  behavioralGuidelines: string[];
  codingStandards: string[];
  reviewChecklist: string[];
  stylePreferences: string[];
}

/**
 * 规则文件配置
 */
export interface RulesConfig {
  enabled: boolean;
  path: string;
  rules: ProjectRules;
}

/**
 * 项目规则加载器接口
 */
export interface ProjectRulesLoader {
  loadProjectRules(cwd: string): Promise<RulesConfig | null>;
  parseProjectRules(content: string): ProjectRules;
  extractRulesBySection(content: string, section: string): string[];
  getMemoryFiles(cwd: string): Promise<MemoryFileInfo[]>;
  getProjectRulesContent(
    files: MemoryFileInfo[],
    filter?: (type: MemoryType) => boolean
  ): string;
}

export class ProjectRulesLoaderImpl implements ProjectRulesLoader {
  private readonly DEFAULT_RULES_FILENAME = 'ProjectRules.md';
  private readonly DEFAULT_RULES_DIRNAME = '.project-rules';
  private readonly RULES_DIRNAME = 'rules';

  async loadProjectRules(cwd: string): Promise<RulesConfig | null> {
    const filePath = join(cwd, this.DEFAULT_RULES_FILENAME);
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const rules = this.parseProjectRules(content);
      return { enabled: true, path: filePath, rules };
    } catch {
      // @ignore-catch: file read failure
      return null;
    }
  }

  parseProjectRules(content: string): ProjectRules {
    return {
      behavioralGuidelines: this.extractRulesBySection(
        content,
        'Behavioral Guidelines'
      ),
      codingStandards: this.extractRulesBySection(content, 'Coding Standards'),
      reviewChecklist: this.extractRulesBySection(content, 'Review Checklist'),
      stylePreferences: this.extractRulesBySection(
        content,
        'Style Preferences'
      ),
    };
  }

  extractRulesBySection(content: string, section: string): string[] {
    const sectionRegex = new RegExp(`##\\s*${section}[^#]*`, 'i');
    const match = content.match(sectionRegex);
    if (!match) return [];
    const sectionContent = match[0];
    const bulletPoints = sectionContent.match(/[-*+]\s+.+/g) || [];
    return bulletPoints.map((point) => point.replace(/^[-*+]\s+/, '').trim());
  }

  /**
   * 获取所有记忆文件
   * 从多个目录发现记忆文件，按优先级排序
   */
  async getMemoryFiles(cwd: string): Promise<MemoryFileInfo[]> {
    const files: MemoryFileInfo[] = [];
    const processedPaths = new Set<string>();

    const managedDir = this.getManagedRulesDir();
    const userDir = join(homedir(), '.project-rules');
    const projectDirs = this.discoverProjectDirs(cwd);

    const discovered: Array<{
      dir: string;
      type: MemoryType;
      isFile?: boolean;
    }> = [];

    if (managedDir) {
      discovered.push({
        dir: join(managedDir, this.DEFAULT_RULES_FILENAME),
        type: 'Managed',
        isFile: true,
      });
      const rulesDir = join(managedDir, this.RULES_DIRNAME);
      if (existsSync(rulesDir)) {
        for (const f of this.getMdFiles(rulesDir)) {
          discovered.push({ dir: f, type: 'Managed' });
        }
      }
    }

    discovered.push({
      dir: join(userDir, this.DEFAULT_RULES_FILENAME),
      type: 'User',
      isFile: true,
    });
    const userRulesDir = join(userDir, this.RULES_DIRNAME);
    if (existsSync(userRulesDir)) {
      for (const f of this.getMdFiles(userRulesDir)) {
        discovered.push({ dir: f, type: 'User' });
      }
    }

    for (const projectDir of projectDirs) {
      discovered.push({
        dir: join(projectDir, this.DEFAULT_RULES_FILENAME),
        type: 'Project',
        isFile: true,
      });
      const rulesRootDir = join(projectDir, this.DEFAULT_RULES_DIRNAME);
      if (existsSync(rulesRootDir)) {
        discovered.push({
          dir: join(rulesRootDir, this.DEFAULT_RULES_FILENAME),
          type: 'Project',
          isFile: true,
        });
        const rulesDir = join(rulesRootDir, this.RULES_DIRNAME);
        if (existsSync(rulesDir)) {
          for (const f of this.getMdFiles(rulesDir)) {
            discovered.push({ dir: f, type: 'Project' });
          }
        }
      }
      const localMd = join(
        projectDir,
        `${this.DEFAULT_RULES_FILENAME.replace('.md', '')}.local.md`
      );
      discovered.push({ dir: localMd, type: 'Local', isFile: true });
    }

    for (const entry of discovered) {
      const resolved = resolve(entry.dir);
      if (processedPaths.has(resolved)) continue;
      if (entry.isFile && !existsSync(resolved)) continue;

      const fileInfo = entry.isFile
        ? this.loadMemoryFile(resolved, entry.type)
        : this.loadMemoryFile(resolved, entry.type);

      if (fileInfo) {
        processedPaths.add(resolved);
        files.push(fileInfo);
      }
    }

    const result = await this.expandIncludes(files, new Set(), 0);
    return result;
  }

  /**
   * 格式化记忆文件为提示文本
   */
  getProjectRulesContent(
    files: MemoryFileInfo[],
    filter?: (type: MemoryType) => boolean
  ): string {
    const memories: string[] = [];
    for (const file of files) {
      if (filter && !filter(file.type)) continue;
      if (!file.content) continue;

      const description = this.getTypeDescription(file.type);
      const content = file.content.trim();
      memories.push(`Contents of ${file.path}${description}:\n\n${content}`);
    }

    if (memories.length === 0) return '';

    const prompt =
      'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.';
    return `${prompt}\n\n${memories.join('\n\n')}`;
  }

  /**
   * 获取 Managed 项目规则目录
   */
  private getManagedRulesDir(): string | null {
    if (process.platform === 'win32') {
      const programData =
        configManager.env('PROGRAMDATA') ||
        join(configManager.env('SYSTEMDRIVE') || 'C:', 'ProgramData');
      return join(programData, 'ProjectRules');
    }
    return '/etc/project-rules';
  }

  /**
   * 从 cwd 向上遍历发现项目目录
   */
  private discoverProjectDirs(cwd: string): string[] {
    const dirs: string[] = [];
    const normalized = normalize(cwd);
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    const systemRoot = process.platform === 'win32' ? `${parts[0]}\\` : '/';

    let current = normalize(cwd);
    while (true) {
      dirs.push(current);
      const parent = dirname(current);
      if (parent === current || parent === systemRoot) break;
      current = parent;
    }

    return dirs.reverse();
  }

  /**
   * 获取目录下所有 .md 文件
   */
  private getMdFiles(dir: string): string[] {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(dir, f))
        .filter((f) => statSync(f).isFile());
    } catch {
      // @ignore-catch: file read failure
      return [];
    }
  }

  /**
   * 加载单个记忆文件
   */
  private loadMemoryFile(
    filePath: string,
    type: MemoryType
  ): MemoryFileInfo | null {
    try {
      if (!existsSync(filePath)) return null;
      const stats = statSync(filePath);
      if (stats.size > MAX_MEMORY_CHARACTER_COUNT) return null;

      const rawContent = readFileSync(filePath, 'utf-8');
      const { frontmatter, content: bodyContent } =
        parseFrontmatter(rawContent);

      let processedContent: string;
      let contentDiffersFromDisk = false;

      const stripped = this.stripHtmlComments(bodyContent || rawContent);
      processedContent = stripped.content;
      if (stripped.stripped) contentDiffersFromDisk = true;

      if (stats.size > MAX_MEMORY_CHARACTER_COUNT) {
        processedContent = processedContent.slice(
          0,
          MAX_MEMORY_CHARACTER_COUNT
        );
        contentDiffersFromDisk = true;
      }

      let globs: string[] | undefined;
      if (frontmatter.paths) {
        const pathsResult = this.parseFrontmatterPaths(frontmatter.paths);
        globs = pathsResult.paths;
        if (pathsResult.contentModified) {
          processedContent = bodyContent || rawContent;
          contentDiffersFromDisk = true;
        }
      }

      return {
        path: filePath,
        type,
        content: processedContent,
        globs,
        contentDiffersFromDisk: contentDiffersFromDisk || undefined,
        rawContent: contentDiffersFromDisk ? rawContent : undefined,
      };
    } catch {
      // @ignore-catch: file read failure
      return null;
    }
  }

  /**
   * 展开 @include 指令
   */
  private async expandIncludes(
    files: MemoryFileInfo[],
    processed: Set<string>,
    depth: number
  ): Promise<MemoryFileInfo[]> {
    if (depth > MAX_INCLUDE_DEPTH) return files;

    const result: MemoryFileInfo[] = [];

    for (const file of files) {
      const includes = this.extractIncludePaths(
        file.content,
        dirname(file.path)
      );

      if (includes.length === 0) {
        result.push(file);
        continue;
      }

      for (const includePath of includes) {
        if (processed.has(includePath)) continue;
        processed.add(includePath);

        if (!existsSync(includePath)) continue;
        const ext = extname(includePath).toLowerCase();
        if (!TEXT_FILE_EXTENSIONS.has(ext)) continue;

        const stats = statSync(includePath);
        if (stats.size > MAX_MEMORY_CHARACTER_COUNT) continue;

        const nestedContent = readFileSync(includePath, 'utf-8');
        const { content: bodyContent } = parseFrontmatter(nestedContent);

        const nestedFile: MemoryFileInfo = {
          path: includePath,
          type: file.type,
          content: bodyContent || nestedContent,
          parent: file.path,
        };

        const expanded = await this.expandIncludes(
          [nestedFile],
          processed,
          depth + 1
        );
        result.push(...expanded);
      }

      result.push(file);
    }

    return result;
  }

  /**
   * 从内容中提取 @include 路径
   */
  private extractIncludePaths(content: string, baseDir: string): string[] {
    const paths: string[] = [];
    const includeRegex = /^@(\S+)$/gm;
    let match: RegExpExecArray | null;

    while ((match = includeRegex.exec(content)) !== null) {
      const rawPath = match[1].trim();
      if (!rawPath) continue;

      let resolvedPath: string;
      if (rawPath.startsWith('~/')) {
        resolvedPath = join(homedir(), rawPath.slice(2));
      } else if (isAbsolute(rawPath)) {
        resolvedPath = rawPath;
      } else {
        resolvedPath = join(baseDir, rawPath);
      }

      paths.push(resolve(resolvedPath));
    }

    return paths;
  }

  /**
   * 解析 Frontmatter paths 字段
   */
  private parseFrontmatterPaths(pathsRaw: unknown): {
    paths?: string[];
    contentModified?: boolean;
  } {
    if (!pathsRaw) return {};

    const patterns: string[] = [];
    if (typeof pathsRaw === 'string') {
      patterns.push(
        ...pathsRaw
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      );
    } else if (Array.isArray(pathsRaw)) {
      patterns.push(
        ...pathsRaw.filter((p): p is string => typeof p === 'string')
      );
    }

    const cleaned = patterns
      .map((p) => (p.endsWith('/**') ? p.slice(0, -3) : p))
      .filter((p) => p.length > 0);

    if (cleaned.length === 0 || cleaned.every((p) => p === '**')) {
      return {};
    }

    return { paths: cleaned, contentModified: true };
  }

  /**
   * 剥离 HTML 注释
   * 块级HTML注释剥离，保留代码块和行内注释
   */
  private stripHtmlComments(content: string): {
    content: string;
    stripped: boolean;
  } {
    if (!content.includes('<!--')) {
      return { content, stripped: false };
    }

    let stripped = false;
    const result = content.replace(/<!--[\s\S]*?-->/g, (match) => {
      if (match.includes('-->')) {
        stripped = true;
        return '';
      }
      return match;
    });

    return { content: result, stripped };
  }

  /**
   * 获取记忆类型的描述文本
   */
  private getTypeDescription(type: MemoryType): string {
    switch (type) {
      case 'Managed':
        return ' (managed system instructions)';
      case 'User':
        return " (user's private global instructions for all projects)";
      case 'Project':
        return ' (project instructions, checked into the codebase)';
      case 'Local':
        return " (user's private project instructions, not checked in)";
      case 'AutoMem':
        return " (user's auto-memory, persists across conversations)";
      case 'TeamMem':
        return ' (shared team memory, synced across the organization)';
      default:
        return '';
    }
  }
}

/**
 * 过滤已注入的记忆文件
 * 当 memory attachment 功能启用时，过滤掉已通过附件方式注入的记忆文件
 * 避免在系统提示中重复注入
 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
  options?: {
    skipTypes?: MemoryType[];
  }
): MemoryFileInfo[] {
  const skipTypes = options?.skipTypes ?? ['AutoMem', 'TeamMem'];
  return files.filter((f) => !skipTypes.includes(f.type));
}

export function createProjectRulesLoader(): ProjectRulesLoader {
  return new ProjectRulesLoaderImpl();
}
