/**
 * ImageDownloader — URL 图片下载服务
 *
 * 功能链路：SSRF 检查 → DNS rebinding 防护 → 下载 → 缓存 → MIME 校验
 * 对标 Hermes vision_tools.py 的 _download_image() + _ssrf_redirect_guard()
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { resolveCacheDir } from '@modules/core/paths';
import { withRetry } from '@modules/utils/withRetry';
import { checkSsrf } from '../../tools/WebFetchTool/ssrf';
import { imageFormatDetector } from '../../media/image/ImageFormatDetector';
import * as crypto from 'crypto';
import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const logger = getLogger('chat:services:ImageDownloader');

/** 从环境变量读取配置，不存在时使用默认值 */
function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function envStr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

/** 默认最大下载大小（50MB），可通过 IMAGE_DOWNLOAD_MAX_SIZE_MB 覆盖 */
const DEFAULT_MAX_SIZE = envInt('IMAGE_DOWNLOAD_MAX_SIZE_MB', 50) * 1024 * 1024;

/** 默认重试次数，可通过 IMAGE_DOWNLOAD_MAX_RETRIES 覆盖 */
const DEFAULT_MAX_RETRIES = envInt('IMAGE_DOWNLOAD_MAX_RETRIES', 3);

/** 默认重试退避基准（ms），可通过 IMAGE_DOWNLOAD_RETRY_DELAY_MS 覆盖 */
const DEFAULT_RETRY_DELAY_MS = envInt('IMAGE_DOWNLOAD_RETRY_DELAY_MS', 2000);

/** 默认缓存 TTL（ms），可通过 IMAGE_DOWNLOAD_CACHE_TTL_MS 覆盖 */
const DEFAULT_CACHE_TTL_MS = envInt(
  'IMAGE_DOWNLOAD_CACHE_TTL_MS',
  24 * 60 * 60 * 1000
);

/** 缓存子目录，可通过 IMAGE_DOWNLOAD_CACHE_DIR 覆盖 */
const CACHE_SUBDIR = envStr('IMAGE_DOWNLOAD_CACHE_DIR', 'vision');

/** 下载结果 */
export interface ImageDownloadResult {
  traceId: string;
  localPath: string;
  mimeType: string;
  size: number;
  fromCache: boolean;
}

/** 下载配置 */
export interface ImageDownloadConfig {
  maxSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
}

export class ImageDownloader {
  private config: ImageDownloadConfig;

  /** 并发控制：同一 URL 同时触发两次下载时，第二个请求等待第一个完成 */
  private pendingRequests = new Map<string, Promise<ImageDownloadResult>>();

  constructor(config: ImageDownloadConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? DEFAULT_MAX_SIZE,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    };
  }

  /**
   * 下载图片到本地缓存
   * @param url 图片 URL（支持 http/https/data/file）
   * @param traceId 链路追踪 ID（可选，不传则自动生成）
   */
  async download(url: string, traceId?: string): Promise<ImageDownloadResult> {
    const tid = traceId ?? crypto.randomUUID();

    logger.info('开始下载图片', { traceId: tid, url });

    // 处理 data: URI
    if (url.startsWith('data:')) {
      return this.handleDataUri(url, tid);
    }

    // 处理 file:// URI
    if (url.startsWith('file://')) {
      return this.handleFileUri(url, tid);
    }

    // 并发控制：同一 URL 同时触发两次下载时，第二个请求等待第一个完成
    const pending = this.pendingRequests.get(url);
    if (pending) {
      logger.info('复用进行中的下载请求', { traceId: tid, url });
      return pending;
    }

    const downloadPromise = this.handleHttpDownload(url, tid);
    this.pendingRequests.set(url, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.pendingRequests.delete(url);
    }
  }

  /**
   * 处理 data: URI
   */
  private handleDataUri(url: string, traceId: string): ImageDownloadResult {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Invalid data URI: ${url.substring(0, 50)}...`);
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const cachePath = this.getCachePath(url, mimeType);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, buffer);

    logger.info('data: URI 已写入缓存', {
      traceId,
      size: buffer.length,
      mimeType,
      cachePath,
    });

    return {
      traceId,
      localPath: cachePath,
      mimeType,
      size: buffer.length,
      fromCache: false,
    };
  }

  /**
   * 处理 file:// URI
   */
  private handleFileUri(url: string, traceId: string): ImageDownloadResult {
    let filePath: string;
    if (url.startsWith('file:///')) {
      filePath = url.substring(8);
    } else if (url.startsWith('file://')) {
      filePath = url.substring(7);
    } else {
      throw new Error(`Invalid file URI: ${url}`);
    }

    // Windows 路径处理
    if (process.platform === 'win32' && filePath.match(/^[a-zA-Z]:/)) {
      filePath = filePath.replace(/^\//, '');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);
    const formatResult = imageFormatDetector.detectFormat(buffer);
    const mimeType = formatResult?.mimeType || 'application/octet-stream';

    logger.info('file:// URI 已读取', {
      traceId,
      size: stat.size,
      mimeType,
      filePath,
    });

    return {
      traceId,
      localPath: filePath,
      mimeType,
      size: stat.size,
      fromCache: false,
    };
  }

  /**
   * HTTP/HTTPS 下载（含 SSRF 检查、DNS rebinding 防护、重试、缓存）
   */
  private async handleHttpDownload(
    url: string,
    traceId: string
  ): Promise<ImageDownloadResult> {
    // 1. SSRF 检查
    const ssrfResult = await checkSsrf(url);
    if (ssrfResult.blocked) {
      logger.warn('SSRF 拦截', { traceId, url, reason: ssrfResult.reason });
      throw new Error(
        `该图片地址因安全策略被拦截（SSRF）：${ssrfResult.reason}`
      );
    }

    // 2. DNS rebinding 防护：下载前解析
    const hostname = new URL(url).hostname;
    const preResolve = await this.resolveHostname(hostname);

    // 3. 检查缓存
    const cached = this.checkCache(url);
    if (cached) {
      logger.info('缓存命中', { traceId, url, cachePath: cached.localPath });
      return cached;
    }

    // 4. 下载（使用 withRetry 标准重试）
    return withRetry(() => this.downloadOnce(url, traceId, preResolve), {
      maxRetries: this.config.maxRetries! - 1,
      initialDelayMs: this.config.retryDelayMs,
    });
  }

  /**
   * 单次下载尝试
   */
  private async downloadOnce(
    url: string,
    traceId: string,
    preResolve: string[]
  ): Promise<ImageDownloadResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          Accept: 'image/*',
          'User-Agent': 'Liri-ImageDownloader/1.0',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 重定向后 SSRF 检查（对标 Hermes _ssrf_redirect_guard()）
      if (response.redirected) {
        const finalUrl = response.url;
        const finalHostname = new URL(finalUrl).hostname;

        // DNS rebinding：下载后解析
        const postResolve = await this.resolveHostname(finalHostname);
        if (
          preResolve.length > 0 &&
          postResolve.length > 0 &&
          !preResolve.some((ip) => postResolve.includes(ip))
        ) {
          throw new Error('DNS 解析异常，下载被拦截（DNS rebinding 检测）');
        }

        const redirectSsrfResult = await checkSsrf(finalUrl);
        if (redirectSsrfResult.blocked) {
          throw new Error(
            `重定向目标被 SSRF 拦截：${redirectSsrfResult.reason}`
          );
        }

        logger.info('重定向后 SSRF 检查通过', {
          traceId,
          originalUrl: url,
          finalUrl,
        });
      }

      // Content-Length 预检
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > this.config.maxSize!) {
          throw new Error(
            `图片过大（${(size / 1024 / 1024).toFixed(1)}MB），上限 ${(this.config.maxSize! / 1024 / 1024).toFixed(0)}MB`
          );
        }
      }

      // 下载到内存
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > this.config.maxSize!) {
        throw new Error(
          `图片过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），上限 ${(this.config.maxSize! / 1024 / 1024).toFixed(0)}MB`
        );
      }

      // MIME 校验（magic bytes）
      const formatResult = imageFormatDetector.detectFormat(buffer);
      if (!formatResult) {
        throw new Error('下载内容不是有效的图片格式');
      }
      const mimeType = formatResult.mimeType;

      // 写入缓存
      const cachePath = this.getCachePath(url, mimeType);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, buffer);

      logger.info('图片下载完成', {
        traceId,
        url,
        size: buffer.length,
        mimeType,
        cachePath,
      });

      return {
        traceId,
        localPath: cachePath,
        mimeType,
        size: buffer.length,
        fromCache: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 检查缓存
   */
  private checkCache(url: string): ImageDownloadResult | null {
    const cacheDir = path.join(resolveCacheDir(), CACHE_SUBDIR);
    const hash = createHash('sha256').update(url).digest('hex');

    // 查找匹配的缓存文件（不关心扩展名）
    if (!fs.existsSync(cacheDir)) {
      return null;
    }

    const files = fs.readdirSync(cacheDir);
    const cachedFile = files.find((f) => f.startsWith(hash));

    if (!cachedFile) {
      return null;
    }

    const cachePath = path.join(cacheDir, cachedFile);

    // 检查缓存是否过期
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age > this.config.cacheTtlMs!) {
      logger.info('缓存已过期，重新下载', {
        url,
        age: `${(age / 1000 / 60).toFixed(0)}min`,
      });
      fs.unlinkSync(cachePath);
      return null;
    }

    const buffer = fs.readFileSync(cachePath);
    const formatResult = imageFormatDetector.detectFormat(buffer);
    const mimeType = formatResult?.mimeType || 'application/octet-stream';

    return {
      traceId: crypto.randomUUID(),
      localPath: cachePath,
      mimeType,
      size: stat.size,
      fromCache: true,
    };
  }

  /**
   * 获取缓存文件路径
   */
  private getCachePath(url: string, mimeType: string): string {
    const cacheDir = path.join(resolveCacheDir(), CACHE_SUBDIR);
    const hash = createHash('sha256').update(url).digest('hex');
    const ext = mimeType.split('/')[1] || 'bin';
    return path.join(cacheDir, `${hash}.${ext}`);
  }

  /**
   * DNS 解析（用于 DNS rebinding 防护）
   */
  private async resolveHostname(hostname: string): Promise<string[]> {
    try {
      return await dns.promises.resolve4(hostname);
    } catch {
      return [];
    }
  }
}

/** 全局单例 */
export const imageDownloader = new ImageDownloader();
