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
 * BrowserVisionTool — 浏览器截图 + 视觉分析
 *
 * 对当前浏览器页面截图，保存到临时文件，然后调用视觉模型分析页面内容。
 * 参照 hermes hermes/tools/browser_tool.py browser_vision
 */

import { BaseTool } from '../BaseTool';
import type { ToolUseContext, ToolResult, ToolParam } from '../types';
import {
  resolveModelRoute,
  RouteKey,
} from '../../ai/router/resolveModelRoute.js';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveTempDir } from '@modules/core/paths';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:browser-vision',
});

interface BrowserVisionInput {
  /** 分析提示词 */
  prompt?: string;
  /** 截图质量 0-100 */
  quality?: number;
  /** 是否返回截图路径 */
  returnScreenshot?: boolean;
}

export class BrowserVisionTool extends BaseTool {
  name = 'browser_vision';

  description =
    'Capture a screenshot of the current browser page and analyze it using vision AI. ' +
    'Returns both the AI analysis and an optional screenshot path.';

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description:
        'What to analyze in the screenshot (e.g. "Describe this webpage", "Find the login button")',
      required: false,
      default: 'Describe this webpage in detail',
    },
    {
      name: 'quality',
      type: 'number',
      description: 'JPEG quality 0-100 (default 80)',
      required: false,
    },
    {
      name: 'returnScreenshot',
      type: 'boolean',
      description: 'Return the screenshot path (default true)',
      required: false,
    },
  ];

  async execute(
    input: BrowserVisionInput,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const prompt = input.prompt || 'Describe this webpage in detail';

    logger.info('BrowserVisionTool.execute()', { prompt: prompt.slice(0, 80) });

    try {
      // Step 1: 获取浏览器截图
      const screenshotPath = await this.captureScreenshot(input.quality || 80);
      if (!screenshotPath) {
        return {
          success: false,
          error: '无法获取浏览器截图。请确保浏览器已打开页面。',
          data: null,
        };
      }

      logger.info('BrowserVisionTool · 截图完成', { path: screenshotPath });

      // Step 2: 读取截图并转为 base64
      const buffer = fs.readFileSync(screenshotPath);
      const base64 = buffer.toString('base64');

      // Step 3: 调用视觉模型分析
      // 通过 ImageAnalysisTool 的 L3 vision 路径进行分析
      let analysis = '';
      try {
        // 通过统一模型路由获取视觉识别模型
        const visionModel = await resolveModelRoute(RouteKey.IMAGE_ANALYZE);
        const visionProvider = providerRegistry.getByModel(visionModel);

        if (visionProvider?.analyzeImage) {
          const result = await visionProvider.analyzeImage({
            imageBuffer: buffer,
            mimeType: 'image/jpeg',
            prompt,
            maxTokens: 1024,
            model: visionModel,
          });

          if (result.success) {
            analysis = result.description;
          } else {
            analysis = `视觉分析失败: ${result.error}`;
          }
        } else {
          analysis = '未找到可用的视觉分析 Provider';
        }
      } catch (err) {
        analysis = `视觉分析异常: ${(err as Error).message}`;
      }

      // Step 4: 清理临时截图
      if (!input.returnScreenshot) {
        try {
          fs.unlinkSync(screenshotPath);
        } catch {
          /* ignore */
        }
      }

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        data: {
          analysis,
          screenshotPath:
            input.returnScreenshot !== false ? screenshotPath : undefined,
          durationMs,
          prompt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `浏览器截图分析失败: ${(error as Error).message}`,
        data: null,
      };
    }
  }

  /**
   * 获取浏览器截图
   * 根据运行环境自动选择截图方式：
   * - Tauri 环境：使用内置浏览器截图 API
   * - Playwright/Puppeteer：使用 CDP 协议
   */
  private async captureScreenshot(quality: number): Promise<string | null> {
    const outputDir = path.join(resolveTempDir(), 'browser-screenshots');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${randomUUID()}.jpg`);

    try {
      // 尝试通过 CDP 获取浏览器截图
      // 默认连接本地 CDP 端口 9222（Chrome/Edge 调试端口）
      const cdpUrl = 'http://127.0.0.1:9222';

      // 获取第一个页面的 CDP WebSocket URL
      const cdpResponse = await fetch(`${cdpUrl}/json`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!cdpResponse.ok) {
        logger.warn('BrowserVisionTool · CDP 不可用，检查浏览器调试端口');
        return null;
      }

      const pages = (await cdpResponse.json()) as Array<{
        webSocketDebuggerUrl: string;
      }>;
      const wsUrl = pages[0]?.webSocketDebuggerUrl;

      if (!wsUrl) {
        logger.warn('BrowserVisionTool · 无可用浏览器页面');
        return null;
      }

      // 通过 CDP Page.captureScreenshot 获取截图
      const ws = new WebSocket(wsUrl);
      const screenshotBase64 = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('CDP timeout')),
          10000
        );

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              id: 1,
              method: 'Page.captureScreenshot',
              params: { format: 'jpeg', quality, captureBeyondViewport: true },
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.id === 1 && msg.result?.data) {
              clearTimeout(timeout);
              ws.close();
              resolve(msg.result.data);
            }
          } catch {
            /* ignore */
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket error'));
        };
      });

      // 保存截图文件
      fs.writeFileSync(outputPath, Buffer.from(screenshotBase64, 'base64'));
      return outputPath;
    } catch (err) {
      logger.warn('BrowserVisionTool · 截图失败', {
        error: (err as Error).message,
      });
      // 清理空文件
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
      return null;
    }
  }
}
