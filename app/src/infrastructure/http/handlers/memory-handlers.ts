// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { MemoryManagerImpl } from '@modules/memory/MemoryManager';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';

const logger = new Logger({ level: LogLevel.INFO });

// 模块级状态变量
let _fileIndex: Map<string, string[]> | null = null;
let _fileIndexTimestamp: number = 0;
let _memoryManagerInstance: MemoryManagerImpl | null = null;

/**
 * 获取记忆管理器（单例）
 */
async function getMemoryManager(): Promise<MemoryManagerImpl> {
  if (!_memoryManagerInstance) {
    _memoryManagerInstance = new MemoryManagerImpl();
  }
  return _memoryManagerInstance;
}

// ========== Memory Handlers ==========

export async function handleListMemories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await getMemoryManager();
      const memories = await mm.getAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
    }
  }

export async function handleSearchMemories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'query is required' } }));
        return;
      }

      const mm = await getMemoryManager();
      const memories = await mm.getRelevantMemories(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
    }
  }

export async function handleGetMemory(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
    }
  }

export async function handleCreateMemory(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const params = JSON.parse(body);

      if (!params.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'content is required' } }));
        return;
      }

      const mm = await getMemoryManager();
      const memory = await mm.createMemory({
        content: params.content,
        metadata: {
          name: params.name || '',
          description: params.description || '',
          type: params.type || 'note',
          tags: params.tags || [],
          ...(params.metadata || {}),
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
    }
  }

  /**
   * 处理从文件创建记忆请求
   * POST /v1/memory/create-from-file
   * 读取文件内容，将其存入记忆系统
   */
export async function handleCreateMemoryFromFile(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const { filePath, name, tags } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (!ctx.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied: file path not in whitelist' } }));
        return;
      }

      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { basename } = await import('node:path');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File not found' } }));
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const fileName = basename(filePath);

      const mm = await getMemoryManager();
      const now = new Date();
      const memory = await mm.createMemory({
        content,
        metadata: {
          name: name || fileName,
          description: `从文件 ${fileName} 导入`,
          type: 'knowledge',
          createdAt: now,
          updatedAt: now,
          tags: tags || ['file-import'],
          source: filePath,
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory, fileName }));
    } catch (err) {
    }
  }

export async function handleUpdateMemory(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
      const updates = JSON.parse(body);

      const mm = await getMemoryManager();
      const memory = await mm.updateMemory(memoryId, updates);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
    }
  }

export async function handleDeleteMemory(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await getMemoryManager();
      await mm.deleteMemory(memoryId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
    }
  }

export async function handleDeleteAllMemories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await getMemoryManager();
      const count = await mm.deleteAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedCount: count }));
    } catch (err) {
    }
  }

export async function handleGetMemorySummary(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      const summary = {
        id: memory.id,
        contentPreview:
          memory.content.length > 200
            ? memory.content.slice(0, 200) + '...'
            : memory.content,
        type: memory.metadata.type || 'unknown',
        tags: memory.metadata.tags || [],
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, summary }));
    } catch (err) {
    }
  }

export async function handleGetMemoryWeights(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          weights: { semantic: 0.4, recency: 0.3, frequency: 0.3 },
        })
      );
    } catch (err) {
    }
  }

export async function handleGetSyncStatus(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          status: {
            lastSync: null,
            pendingSync: [],
            failedSync: [],
            syncCount: 0,
          },
        })
      );
    } catch (err) {
    }
  }

export async function handleSyncMemories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Sync not yet implemented',
        })
      );
    } catch (err) {
    }
  }

export async function handleConsolidateMemories(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Consolidation not yet implemented',
        })
      );
    } catch (err) {
    }
  }

  /**
   * 处理文件打开请求
   * GET /api/file/open?path=<encoded_path>
   * 在 Tauri WebView 中点击文件链接时调用，通过 child_process 在系统默认程序中打开文件
   */
export async function handleFileOpen(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      if (process.platform === 'win32') {
        await execAsync(`start "" "${filePath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open "${filePath}"`);
      } else {
        await execAsync(`xdg-open "${filePath}"`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('打开文件失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to open file: ${message}` },
        })
      );
    }
  }

  /**
   * 处理文件读取请求
   * GET /api/file/read?path=<encoded_path>
   * 读取文件内容并返回，支持代码/Markdown/JSON/图片等类型
   */
export async function handleFileRead(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      // 检查文件是否存在
      let actualPath = filePath;
      if (!fs.existsSync(filePath)) {
        // 文件不存在时，尝试模糊搜索匹配（LLM 返回的路径常有截断错误）
        const fuzzyMatch = fuzzyFindFile(filePath);
        if (fuzzyMatch) {
          actualPath = fuzzyMatch;
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: `File not found: ${filePath}` } })
          );
          return;
        }
      }

      const stats = fs.statSync(actualPath);
      const size = stats.size;

      // 判断文件 MIME 类型
      const ext = path.extname(actualPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
      };

      // 图片文件：返回 base64
      if (mimeTypes[ext]) {
        const imageBuffer = fs.readFileSync(actualPath);
        const base64 = imageBuffer.toString('base64');
        const dataUri = `data:${mimeTypes[ext]};base64,${base64}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: dataUri,
            type: 'image',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 不支持预览的二进制文件
      const binaryExts = [
        '.exe',
        '.zip',
        '.rar',
        '.7z',
        '.gz',
        '.tar',
        '.dll',
        '.so',
        '.dylib',
        '.bin',
        '.dat',
        '.wasm',
        '.pdf',
      ];
      if (binaryExts.includes(ext)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: `不支持预览该文件类型 (${ext})`,
            type: 'text',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 文本文件：读取内容
      const maxPreviewSize = 1 * 1024 * 1024; // 1MB
      let content: string;
      if (size > maxPreviewSize) {
        const fd = fs.openSync(actualPath, 'r');
        const buffer = Buffer.alloc(maxPreviewSize);
        fs.readSync(fd, buffer, 0, maxPreviewSize, 0);
        fs.closeSync(fd);
        content =
          buffer.toString('utf-8') + '\n\n... 文件过大，仅显示前 1MB 内容';
      } else {
        content = fs.readFileSync(actualPath, 'utf-8');
      }

      // 根据扩展名判断类型和语言
      const typeMap: Record<string, { type: string; language?: string }> = {
        '.ts': { type: 'code', language: 'typescript' },
        '.tsx': { type: 'code', language: 'tsx' },
        '.js': { type: 'code', language: 'javascript' },
        '.jsx': { type: 'code', language: 'jsx' },
        '.py': { type: 'code', language: 'python' },
        '.rs': { type: 'code', language: 'rust' },
        '.go': { type: 'code', language: 'go' },
        '.java': { type: 'code', language: 'java' },
        '.c': { type: 'code', language: 'c' },
        '.cpp': { type: 'code', language: 'cpp' },
        '.h': { type: 'code', language: 'c' },
        '.hpp': { type: 'code', language: 'cpp' },
        '.css': { type: 'code', language: 'css' },
        '.scss': { type: 'code', language: 'scss' },
        '.html': { type: 'code', language: 'html' },
        '.xml': { type: 'code', language: 'xml' },
        '.yaml': { type: 'yaml', language: 'yaml' },
        '.yml': { type: 'yaml', language: 'yaml' },
        '.toml': { type: 'yaml', language: 'toml' },
        '.json': { type: 'json', language: 'json' },
        '.md': { type: 'markdown', language: 'markdown' },
        '.mdx': { type: 'markdown', language: 'mdx' },
        '.txt': { type: 'text', language: undefined },
        '.log': { type: 'text', language: undefined },
        '.csv': { type: 'text', language: undefined },
        '.env': { type: 'text', language: undefined },
        '.sql': { type: 'code', language: 'sql' },
        '.sh': { type: 'code', language: 'bash' },
        '.bash': { type: 'code', language: 'bash' },
        '.zsh': { type: 'code', language: 'bash' },
        '.ps1': { type: 'code', language: 'powershell' },
        '.bat': { type: 'code', language: 'batch' },
        '.cmd': { type: 'code', language: 'batch' },
        '.rb': { type: 'code', language: 'ruby' },
        '.php': { type: 'code', language: 'php' },
        '.swift': { type: 'code', language: 'swift' },
        '.kt': { type: 'code', language: 'kotlin' },
        '.scala': { type: 'code', language: 'scala' },
        '.r': { type: 'code', language: 'r' },
        '.lua': { type: 'code', language: 'lua' },
        '.dart': { type: 'code', language: 'dart' },
        '.vue': { type: 'code', language: 'vue' },
        '.svelte': { type: 'code', language: 'svelte' },
        '.astro': { type: 'code', language: 'astro' },
        '.graphql': { type: 'code', language: 'graphql' },
        '.prisma': { type: 'code', language: 'prisma' },
        '.tf': { type: 'code', language: 'hcl' },
        '.dockerfile': { type: 'code', language: 'dockerfile' },
        '.makefile': { type: 'code', language: 'makefile' },
      };

      const fileInfo = typeMap[ext] || { type: 'text', language: undefined };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content,
          type: fileInfo.type,
          size,
          language: fileInfo.language,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('读取文件失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to read file: ${message}` },
        })
      );
    }
  }

  /**
   * 处理获取基础路径请求
   * GET /api/file/paths
   * 返回所有已知的基础目录路径，供前端解析不完整的文件路径使用
   */
export async function handleFilePaths(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const {
      resolveProjectRoot,
      resolvePyappHome,
      resolveOutputDir,
      resolveDownloadsDir,
      resolveDataDir,
      resolveDocsDir,
    } = await import('@modules/core/paths');
    const projectRoot = resolveProjectRoot();
    const basePaths = {
      projectRoot,
      pyappHome: resolvePyappHome(),
      outputDir: resolveOutputDir(),
      downloadsDir: resolveDownloadsDir(),
      dataDir: resolveDataDir(),
      docsDir: resolveDocsDir(),
      appDir: path.join(projectRoot, 'app'),
      clientDir: path.join(projectRoot, 'client'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(basePaths));
  }

  /**
   * 处理文件路径解析请求
   * GET /api/file/resolve-path?path=<encoded_path>
   * 将可能不完整的文件路径解析为完整的绝对路径
   * 如果路径已存在，直接返回；否则依次在各基础目录下尝试查找
   */
export async function handleFileResolvePath(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const rawPath = parsedUrl.searchParams.get('path');

      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      const {
        resolveProjectRoot,
        resolvePyappHome,
        resolveOutputDir,
        resolveDownloadsDir,
        resolveDataDir,
        resolveDocsDir,
      } = await import('@modules/core/paths');

      if (path.isAbsolute(rawPath)) {
        if (fs.existsSync(rawPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: rawPath, exists: true }));
          return;
        }
        // 精确路径不存在时，尝试模糊文件名搜索（LLM 返回的路径常有截断/拼写错误）
        const fuzzyResult = fuzzyFindFile(rawPath);
        if (fuzzyResult) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: fuzzyResult, exists: true }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resolvedPath: rawPath, exists: false }));
        return;
      }

      if (rawPath.startsWith('~')) {
        const pyappHome = resolvePyappHome();
        const withoutTilde = rawPath.replace(/^~[/\\]?/, '');
        const fullPath = path.join(pyappHome, withoutTilde);
        if (fs.existsSync(fullPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: fullPath, exists: true }));
          return;
        }
      }

      const projectRoot = resolveProjectRoot();
      const baseDirs = [
        projectRoot,
        resolvePyappHome(),
        resolveOutputDir(),
        resolveDownloadsDir(),
        resolveDataDir(),
        resolveDocsDir(),
        path.join(projectRoot, 'app'),
        path.join(projectRoot, 'client'),
      ];

      for (const baseDir of baseDirs) {
        const candidate = path.join(baseDir, rawPath);
        if (fs.existsSync(candidate)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: candidate, exists: true }));
          return;
        }
      }

      const guessedPath = path.join(projectRoot, rawPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resolvedPath: guessedPath, exists: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('解析文件路径失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to resolve path: ${message}` },
        })
      );
    }
  }

  // ========== 模糊文件路径搜索（LLM 路径纠错） ==========

  /**
   * 索引缓存过期时间（毫秒）
   */
const FILE_INDEX_TTL = 60 * 60 * 1000; // 1 小时

  /**
   * 当精确路径不存在时，通过文件名模糊搜索项目目录树，找到最匹配的真实文件
   *
   * @param rawPath 可能不准确的路径
   * @returns 匹配的真实文件绝对路径，未找到则返回 null
   */
function fuzzyFindFile(rawPath: string): string | null {
    const basename = path.basename(rawPath);
    if (!basename) return null;

    // 构建或重建文件索引
    const index = getOrBuildFileIndex();

    // 1. 精确匹配 basename（区分大小写）
    if (index.has(basename)) {
      return index.get(basename)![0];
    }

    // 2. 小写不敏感匹配
    const lowerBasename = basename.toLowerCase();
    for (const [name, paths] of index) {
      if (name.toLowerCase() === lowerBasename) {
        return paths[0];
      }
    }

    // 3. 去掉扩展名后匹配
    const stem = path.parse(basename).name.toLowerCase();
    for (const [name, paths] of index) {
      if (path.parse(name).name.toLowerCase() === stem) {
        return paths[0];
      }
    }

    // 4. 包含关系匹配：搜索文件名包含目标关键部分，或目标包含文件名
    for (const [name, paths] of index) {
      const lowerName = name.toLowerCase();
      if (lowerName.includes(lowerBasename) || lowerBasename.includes(lowerName)) {
        return paths[0];
      }
      // 尝试用 stem（无扩展名）做包含匹配
      if (stem.length > 3) {
        const nameStem = path.parse(name).name.toLowerCase();
        if (nameStem.includes(stem) || stem.includes(nameStem)) {
          return paths[0];
        }
      }
    }

    return null;
  }

  /**
   * 获取或构建文件索引（带缓存）
   * 递归扫描项目根目录下所有文件，建立 basename → [fullPath] 映射
   */
function getOrBuildFileIndex(): Map<string, string[]> {
    const now = Date.now();
    if (
      _fileIndex &&
      (now - _fileIndexTimestamp) < FILE_INDEX_TTL
    ) {
      return _fileIndex;
    }

    const index = new Map<string, string[]>();

    // 确定搜索根目录（优先用项目根目录，fallback 到 process.cwd()）
    let rootDir: string;
    try {
      const { resolveProjectRoot } = require('@modules/core/paths') as typeof import('@modules/core/paths');
      rootDir = resolveProjectRoot();
    } catch {
      rootDir = process.cwd();
    }

    // 非递归栈式遍历（避免深层递归栈溢出）
    const dirsToScan = [rootDir];
    const scanned = new Set<string>();
    const maxFiles = 50000; // 安全上限
    let fileCount = 0;

    while (dirsToScan.length > 0 && fileCount < maxFiles) {
      const dir = dirsToScan.pop()!;
      if (scanned.has(dir)) continue;
      scanned.add(dir);

      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue; // 无权限等跳过
      }

      for (const entry of entries) {
        if (fileCount >= maxFiles) break;
        const fullPath = path.join(dir, entry);

        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            // 跳过 node_modules、.git、.next、dist 等常见大目录
            const dirName = path.basename(fullPath);
            if (
              dirName === 'node_modules' ||
              dirName === '.git' ||
              dirName === '.next' ||
              dirName === 'dist' ||
              dirName === '.turbo' ||
              dirName === 'target' ||
              dirName === '.cache' ||
              dirName === '__pycache__' ||
              dirName === '.pyapp' ||
              dirName.startsWith('.')
            ) {
              continue;
            }
            dirsToScan.push(fullPath);
          } else if (stat.isFile()) {
            fileCount++;
            const key = path.basename(fullPath);
            const existing = index.get(key);
            if (existing) {
              existing.push(fullPath);
            } else {
              index.set(key, [fullPath]);
            }
          }
        } catch {
          continue;
        }
      }
    }

    _fileIndex = index;
    _fileIndexTimestamp = now;
    logger.debug('文件索引构建完成', { rootDir, totalFiles: fileCount, uniqueNames: index.size });
    return index;
  }
