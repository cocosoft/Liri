import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

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
    const truncated = content.length > MAX_FILE_CHARS;
    const safeContent = truncated
      ? content.substring(0, MAX_FILE_CHARS) + '\n...(truncated)'
      : content;

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

export function readAgentsMd(cwd: string): string | null {
  const files = scanWorkspaceFiles(cwd);
  if (!files.agentsMd) return null;

  const parts: string[] = [];
  parts.push(files.agentsMd.content);

  if (files.agentsDirFiles.length > 0) {
    for (const f of files.agentsDirFiles) {
      parts.push(`\n---\n\n# ${f.name}\n\n${f.content}`);
    }
  }

  return parts.join('\n');
}

export function readToolsMd(cwd: string): string | null {
  const files = scanWorkspaceFiles(cwd);
  return files.toolsMd?.content ?? null;
}

export function clearWorkspaceCache(): void {
  fileCache.clear();
  logger.debug('Workspace file cache cleared');
}
