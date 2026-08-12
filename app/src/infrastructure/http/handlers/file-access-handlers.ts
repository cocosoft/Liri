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

/**
 * file-access-handlers.ts — 文件访问类 handler
 *
 * 从 LocalHTTPService.ts 提取的文件打开/读取/路径解析/预览 handler，
 * 统一使用 (ctx, req, res) 标准签名。
 */

import type http from 'http';
import fs from 'fs';
import path from 'path';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

/**
 * 文件访问统一白名单（Access denied 根治，2026-08-12）：
 * 此前 resolve-path 允许解析 8 个 baseDirs（含整个项目根），但 read/preview/open
 * 只校验 isPathWithin(pyappHome) → 能解析出来的项目源码文件（projectRoot/app、
 * projectRoot/client 等）读不了，点击 FileLink 即 403 "Access denied"。
 * 统一收口：所有文件访问类 handler 共用此白名单，解析范围 == 读取范围。
 */
export async function getAllowedBaseDirs(): Promise<string[]> {
  const {
    resolveProjectRoot,
    resolvePyappHome,
    resolveOutputDir,
    resolveDownloadsDir,
    resolveDataDir,
    resolveDocsDir,
  } = await import('@modules/core/paths');
  const projectRoot = resolveProjectRoot();
  return [
    projectRoot,
    resolvePyappHome(),
    resolveOutputDir(),
    resolveDownloadsDir(),
    resolveDataDir(),
    resolveDocsDir(),
    path.join(projectRoot, 'app'),
    path.join(projectRoot, 'client'),
  ];
}

/** 判断文件路径是否在文件访问白名单（任一 baseDir）内 */
export async function isPathAllowed(filePath: string): Promise<boolean> {
  const { isPathWithin } = await import('@modules/core/paths');
  const baseDirs = await getAllowedBaseDirs();
  return baseDirs.some((dir) => isPathWithin(dir, filePath));
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
      return;
    }

    // 安全校验：路径必须在文件访问白名单（统一 baseDirs，见 getAllowedBaseDirs）
    if (!(await isPathAllowed(filePath))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Access denied: path outside allowed directory' },
        })
      );
      return;
    }

    // 安全校验：禁止文件名含双引号，防止命令注入
    if (filePath.includes('"')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Invalid path: contains illegal characters' },
        })
      );
      return;
    }

    // 使用 spawn 替代 exec 避免 shell 解析注入（& | ; 等字符）
    const { spawn } = await import('child_process');
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '""', filePath], {
        shell: false,
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [filePath], {
        shell: false,
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
    } else {
      const child = spawn('xdg-open', [filePath], {
        shell: false,
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
      return;
    }

    // 安全校验：路径必须在文件访问白名单（统一 baseDirs，见 getAllowedBaseDirs）
    if (!(await isPathAllowed(filePath))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Access denied' } }));
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
    await handleError(err, {
      module: 'infra:http',
      action: 'file_read',
      context: { path: req.url },
    });
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
      containsPathTraversal,
    } = await import('@modules/core/paths');

    // BUG-C 修复：绝对路径必须验证在文件访问白名单（统一 baseDirs）
    if (path.isAbsolute(rawPath)) {
      if (!(await isPathAllowed(rawPath))) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            resolvedPath: rawPath,
            exists: false,
            restricted: true,
          })
        );
        return;
      }
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
      // BUG-D 修复：禁止 tilde 展开后的路径遍历
      if (containsPathTraversal(withoutTilde)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            resolvedPath: rawPath,
            exists: false,
            restricted: true,
          })
        );
        return;
      }
      const fullPath = path.join(pyappHome, withoutTilde);
      if (fs.existsSync(fullPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resolvedPath: fullPath, exists: true }));
        return;
      }
    }

    const projectRoot = resolveProjectRoot();
    // 统一白名单：与 read/preview/open 的允许范围一致（getAllowedBaseDirs）
    const baseDirs = await getAllowedBaseDirs();

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
    await handleError(err, {
      module: 'infra:http',
      action: 'file_resolve_path',
      context: { path: req.url },
    });
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
      res.end(JSON.stringify({ error: { message: 'Missing path parameter' } }));
      return;
    }

    // 安全校验：路径必须在文件访问白名单（统一 baseDirs，见 getAllowedBaseDirs）
    if (!(await isPathAllowed(filePath))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Access denied' } }));
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
    const officeExts = ['.pdf', '.docx', '.pptx', '.xlsx'];

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
