import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants';
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
 *
 * 2026-11-21（D6-B）：**改为复用 `BrowserSessionDriver` 会话**（与 `BrowserTool` 同一浏览器上下文），
 * 不再直连 CDP 9222。收益：截图的就是工具自己操作的页面（cookie/标签页一致），
 * 且不再要求用户手动开 `--remote-debugging-port`。
 */

import { BaseTool } from '@openliri/tool-base';
import type {
  ToolUseContext,
  ToolResult,
  ToolParam,
} from '@openliri/infra/utils/toolContract/Tool';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { getLogger } from '@openliri/infra/monitoring';
import { saveScreenshotFile } from '@openliri/infra/utils/computerUse/screenshotStore';
import * as fs from 'fs';
import {
  getBrowserSessionDriver,
  type BrowserSessionDriver,
} from './PlaywrightDriver';

const logger = getLogger('tools:browser-vision');

interface BrowserVisionInput {
  /** 分析提示词 */
  prompt?: string;
  /** 截图质量 0-100 */
  quality?: number;
  /** 是否返回截图路径 */
  returnScreenshot?: boolean;
}

/**
 * U-03（2026-10-19）：`browser_vision` 的**模型可见出参结构**（JSON Schema），
 * 与成功分支 `data` 逐字段对齐（失败分支 `data` 为 null）。
 */
const BROWSER_VISION_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    analysis: { type: 'string', description: '视觉模型对截图的文字分析' },
    screenshotPath: {
      type: 'string',
      description: '截图文件路径（returnScreenshot=false 时不返回）',
    },
    durationMs: { type: 'number', description: '截图+分析总耗时（毫秒）' },
    prompt: { type: 'string', description: '实际使用的分析提示词' },
  },
  required: ['analysis', 'durationMs', 'prompt'],
};

export class BrowserVisionTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.browser_vision;

  /**
   * 会话级驱动提供者（默认按 sessionId 复用进程内浏览器上下文，与 `BrowserTool` 同源）。
   * 单测可注入假驱动 ⇒ 不启动真实浏览器。
   */
  constructor(
    private readonly driverProvider: (
      sessionId: string
    ) => Pick<BrowserSessionDriver, 'execute'> = getBrowserSessionDriver
  ) {
    super();
  }

  description =
    '对当前浏览器页面截图，并使用视觉 AI 分析。' +
    '返回 AI 分析结果和可选的截图路径。';

  /** U-03（2026-10-19）：模型可见出参结构（analysis/screenshotPath/durationMs/prompt） */
  override outputJsonSchema = BROWSER_VISION_OUTPUT_JSON_SCHEMA;

  params: ToolParam[] = [
    {
      name: 'prompt',
      type: 'string',
      description:
        '要分析截图中的什么内容（如 "Describe this webpage"、"Find the login button"）',
      required: false,
      default: 'Describe this webpage in detail',
    },
    {
      name: 'quality',
      type: 'number',
      description: 'JPEG 质量 0-100（默认 80）',
      required: false,
    },
    {
      name: 'returnScreenshot',
      type: 'boolean',
      description: '是否返回截图路径（默认 true）',
      required: false,
    },
  ];

  async execute(
    input: BrowserVisionInput,
    context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const prompt = input.prompt || 'Describe this webpage in detail';
    const sessionId = context.sessionId ?? 'default';

    logger.info('BrowserVisionTool.execute()', { prompt: prompt.slice(0, 80) });

    try {
      // Step 1: 从**同一个浏览器会话**截图（与 BrowserTool 共用 context）
      const screenshotPath = await this.captureScreenshot(
        input.quality || 80,
        sessionId
      );
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
      // 2026-11-21 修正：默认（undefined）应当**保留**截图；原写法 `!input.returnScreenshot`
      // 会把"未传参"当成 false ⇒ 返回的 path 指向已删除文件（测试暴露）。
      if (input.returnScreenshot === false) {
        try {
          fs.unlinkSync(screenshotPath);
        } catch (err) {
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
   * 从**当前会话的浏览器上下文**截图（与 `BrowserTool` 共用 `BrowserSessionDriver`）。
   *
   * 2026-11-21（D6-B）：不再直连 CDP 9222 —— 截图对象就是工具自己操作的页面，
   * 且无需用户手动开 `--remote-debugging-port`。截图落盘复用
   * `saveScreenshotFile`（会话级目录，便于与 computer_use 的清理策略对齐）。
   */
  private async captureScreenshot(
    quality: number,
    sessionId: string
  ): Promise<string | null> {
    try {
      const driver = this.driverProvider(sessionId);
      const result = await driver.execute({
        action: 'screenshot',
        format: 'jpeg',
        quality,
        fullPage: false,
      });

      if (!result.success || !result.screenshot) {
        logger.warn('BrowserVisionTool · 截图失败', {
          error: result.error ?? '驱动未返回截图数据',
        });
        return null;
      }

      // 未打开任何页面时驱动会给出 about:blank 的空白页 —— 视为"没有可分析的页面"
      if (!result.url || result.url.startsWith('about:blank')) {
        logger.warn('BrowserVisionTool · 当前浏览器会话没有已打开的页面', {
          sessionId,
          url: result.url,
        });
        return null;
      }

      return saveScreenshotFile(sessionId, result.screenshot, 'jpeg');
    } catch (err) {
      logger.warn('BrowserVisionTool · 截图异常', {
        error: (err as Error).message,
      });
      return null;
    }
  }
}
