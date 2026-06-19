/**
 * memory-handlers.ts — 记忆系统 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  sendError,
  readRequestBody,
  checkFilePathPermission,
} from './handler-utils';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

// ---- Memory Manager Singleton ----

let memoryManagerInstance:
  | import('@modules/memory/MemoryManager').MemoryManagerImpl
  | null = null;

async function getMemoryManager(): Promise<
  import('@modules/memory/MemoryManager').MemoryManagerImpl
> {
  if (!memoryManagerInstance) {
    const { MemoryManagerImpl } = await import('@modules/memory/MemoryManager');
    memoryManagerInstance = new MemoryManagerImpl();
  }
  return memoryManagerInstance;
}

export async function handleListMemories(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const mm = await getMemoryManager();
    const memories = await mm.getAllMemories();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, memories }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleSearchMemories(
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
    sendError(res, err);
  }
}

export async function handleGetMemory(
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
    sendError(res, err);
  }
}

export async function handleCreateMemory(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
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
    sendError(res, err);
  }
}

/**
 * 处理从文件创建记忆请求
 * POST /v1/memory/create-from-file
 * 读取文件内容，将其存入记忆系统
 */
export async function handleCreateMemoryFromFile(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { filePath, name, tags } = JSON.parse(body);

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
      return;
    }

    // 沙箱权限检查
    if (!checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Access denied: file path not in whitelist' },
        })
      );
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
    sendError(res, err);
  }
}

export async function handleUpdateMemory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  memoryId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const updates = JSON.parse(body);

    const mm = await getMemoryManager();
    const memory = await mm.updateMemory(memoryId, updates);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, memory }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleDeleteMemory(
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
    sendError(res, err);
  }
}

export async function handleDeleteAllMemories(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const mm = await getMemoryManager();
    const count = await mm.deleteAllMemories();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deletedCount: count }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleGetMemorySummary(
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
    sendError(res, err);
  }
}

export async function handleGetMemoryWeights(
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
    sendError(res, err);
  }
}

export async function handleGetSyncStatus(
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
    sendError(res, err);
  }
}

export async function handleSyncMemories(
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
    sendError(res, err);
  }
}

export async function handleConsolidateMemories(
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
    sendError(res, err);
  }
}

/**
 * 处理文件打开请求
 * GET /api/file/open?path=<encoded_path>
 * 在 Tauri WebView 中点击文件链接时调用，通过 child_process 在系统默认程序中打开文件
 */
export async function handleFileOpen(
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
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
    await handleError(err, {
      module: 'infra:http',
      action: 'file_open',
      context: { path: req.url },
    });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: `Failed to open file: ${err instanceof Error ? err.message : String(err)}`,
        },
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
      return;
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `File not found: ${filePath}` } })
      );
      return;
    }

    const stats = fs.statSync(filePath);
    const size = stats.size;

    // 判断文件 MIME 类型
    const ext = path.extname(filePath).toLowerCase();
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
      const imageBuffer = fs.readFileSync(filePath);
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
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(maxPreviewSize);
      fs.readSync(fd, buffer, 0, maxPreviewSize, 0);
      fs.closeSync(fd);
      content =
        buffer.toString('utf-8') + '\n\n... 文件过大，仅显示前 1MB 内容';
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
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

/**
 * 处理文件预览转换请求
 * GET /api/file/preview?path=<encoded_path>
 * 对 Office 文件（pdf/docx/pptx）自动转换为 Markdown 后返回，
 * 非 Office 文件降级为纯文本预览（用于前端在转换失败时的兜底展示）
 */
export async function handleFilePreview(
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `File not found: ${filePath}` } })
      );
      return;
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Office 文件扩展名：使用 ConverterEngine 转为 Markdown
    const officeExts = ['.pdf', '.docx', '.pptx'];

    if (officeExts.includes(ext)) {
      const coreAPI = getCoreAPI();
      const result = await coreAPI.convertFile({ filePath });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: result.markdown,
          type: 'markdown',
          size: stats.size,
          language: 'markdown',
          title: result.title,
        })
      );
      return;
    }

    // 非 Office 文件：读取纯文本内容降级预览
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content,
        type: 'text',
        size: stats.size,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'file_preview',
      context: { path: req.url },
    });
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: `Failed to preview file: ${message}` },
      })
    );
  }
}
