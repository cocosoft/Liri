import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getPromptInjectionDetector } from '../../security/injection/PromptInjectionDetector';

const logger = new Logger({ level: LogLevel.INFO });

export interface WorkspaceFile {
  name: string;
  content: string;
  filePath: string;
  mtimeMs: number;
  truncated: boolean;
}

export interface WorkspaceFiles {
  agentsMd: WorkspaceFile | null;
  toolsMd: WorkspaceFile | null;
  agentsDirFiles: WorkspaceFile[];
}

const MAX_FILE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 60_000;

const AGENTS_FILE_NAMES = ['AGENTS.md', 'agents.md', 'Agents.md'];
const TOOLS_FILE_NAMES = ['TOOLS.md', 'tools.md', 'Tools.md'];
const AGENTS_DIR_NAMES = ['AGENTS', 'agents', 'Agents'];

const fileCache = new Map<string, { content: string; mtimeMs: number }>();

function readCached(filePath: string): WorkspaceFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;

    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return {
        name: path.basename(filePath),
        content: cached.content,
        filePath,
        mtimeMs: cached.mtimeMs,
        truncated: false,
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { content: safeContent, truncated } = headTailTruncate(
      content,
      MAX_FILE_CHARS
    );

    fileCache.set(filePath, { content: safeContent, mtimeMs: stat.mtimeMs });

    return {
      name: path.basename(filePath),
      content: safeContent,
      filePath,
      mtimeMs: stat.mtimeMs,
      truncated,
    };
  } catch {
    return null;
  }
}

function findFirstFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    const fp = path.join(dir, name);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return fp;
    }
  }
  return null;
}

function findFirstDir(dir: string, names: string[]): string | null {
  for (const name of names) {
    const dp = path.join(dir, name);
    if (fs.existsSync(dp) && fs.statSync(dp).isDirectory()) {
      return dp;
    }
  }
  return null;
}

function readAgentsDir(dir: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const fp = path.join(dir, entry);
      const file = readCached(fp);
      if (file) files.push(file);
    }
  } catch {
    // directory not accessible
  }
  return files;
}

function applyTotalBudget(files: WorkspaceFile[]): WorkspaceFile[] {
  let total = 0;
  const result: WorkspaceFile[] = [];
  for (const f of files) {
    if (total + f.content.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - total;
      if (remaining > 0) {
        result.push({
          ...f,
          content: f.content.substring(0, remaining) + '\n...(truncated total)',
          truncated: true,
        });
      }
      break;
    }
    result.push(f);
    total += f.content.length;
  }
  return result;
}

export function scanWorkspaceFiles(cwd: string): WorkspaceFiles {
  const agentsMdPath = findFirstFile(cwd, AGENTS_FILE_NAMES);
  const toolsMdPath = findFirstFile(cwd, TOOLS_FILE_NAMES);
  const agentsDirPath = findFirstDir(cwd, AGENTS_DIR_NAMES);

  const agentsMd = agentsMdPath ? readCached(agentsMdPath) : null;
  const toolsMd = toolsMdPath ? readCached(toolsMdPath) : null;
  const agentsDirFiles = agentsDirPath
    ? applyTotalBudget(readAgentsDir(agentsDirPath))
    : [];

  return { agentsMd, toolsMd, agentsDirFiles };
}

/**
 * 剥离 Markdown 文件的 YAML frontmatter
 * 匹配开头的 ---\n...\n---\n 块
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/**
 * head(70%) + tail(30%) 截断策略（对标 Hermes head/tail 截断）
 * 超出 maxChars 时保留开头 70% 和结尾 30%，中间插入截断标记
 */
export function headTailTruncate(
  content: string,
  maxChars: number
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };

  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const removed = content.length - maxChars;
  const marker = `\n... (truncated, ${removed} chars removed) ...\n`;

  return {
    content:
      content.substring(0, headChars) +
      marker +
      content.substring(content.length - tailChars),
    truncated: true,
  };
}

/**
 * 扫描上下文文件内容中的注入威胁（对标 Hermes _scan_context_content()）
 * 检测到威胁时替换为 [BLOCKED: ...] 标记而非完全拒绝
 */
export function scanContextContent(content: string, source: string): string {
  const detector = getPromptInjectionDetector();
  const matches = detector.scan(content);

  if (matches.length === 0) return content;

  const blocked = matches.filter((m) => m.severity !== 'low');
  if (blocked.length === 0) return content;

  logger.warn(`扫描到 ${blocked.length} 个注入威胁，已从 ${source} 中屏蔽`, {
    patterns: blocked.map((m) => m.pattern),
  });

  let result = content;
  const sorted = [...blocked].sort((a, b) => b.index - a.index);
  for (const m of sorted) {
    const before = result.slice(0, m.index);
    const after = result.slice(m.index + m.match.length);
    result = `${before}[BLOCKED: ${m.pattern}]${after}`;
  }

  return result;
}

export function readAgentsMd(cwd: string): string | null {
  const files = scanWorkspaceFiles(cwd);
  if (!files.agentsMd) return null;

  const parts: string[] = [];
  parts.push(stripFrontmatter(files.agentsMd.content));

  if (files.agentsDirFiles.length > 0) {
    for (const f of files.agentsDirFiles) {
      parts.push(`\n---\n\n# ${f.name}\n\n${stripFrontmatter(f.content)}`);
    }
  }

  const merged = parts.join('\n');
  return scanContextContent(merged, 'AGENTS');
}

export function readToolsMd(cwd: string): string | null {
  const files = scanWorkspaceFiles(cwd);
  return files.toolsMd?.content
    ? scanContextContent(stripFrontmatter(files.toolsMd.content), 'TOOLS')
    : null;
}

export function clearWorkspaceCache(): void {
  fileCache.clear();
  logger.debug('Workspace file cache cleared');
}
