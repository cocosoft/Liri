// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 视觉模型分析（单一入口，2026-11-21）
 *
 * 供 `browser_vision` 与 `computer_use(analyze=true)` 共用：把一张图片交给
 * `RouteKey.IMAGE_ANALYZE` 路由到的视觉 Provider，返回**文字结论**（不返回 base64）。
 *
 * 设计约束（CS01）：模型路由与 Provider 选择是既有唯一事实源（`resolveModelRoute` +
 * `providerRegistry`），本模块不新造模型/供应商逻辑；失败按"可诊断"返回而不是抛裸错。
 */

import { providerRegistry, resolveModelRoute, RouteKey } from '@modules/ai';

export interface AnalyzeImageResult {
  ok: boolean;
  /** 成功时为描述文本；失败时为可读原因 */
  text: string;
}

export async function analyzeImageBuffer(params: {
  imageBuffer: Buffer;
  prompt: string;
  mimeType?: string;
  maxTokens?: number;
}): Promise<AnalyzeImageResult> {
  const {
    imageBuffer,
    prompt,
    mimeType = 'image/jpeg',
    maxTokens = 1024,
  } = params;
  try {
    const visionModel = await resolveModelRoute(RouteKey.IMAGE_ANALYZE);
    const visionProvider = providerRegistry.getByModel(visionModel);
    if (!visionProvider?.analyzeImage) {
      return {
        ok: false,
        text: '未找到可用的视觉分析 Provider。请在「模型管理 → 任务分工」把 image_analyze 指向支持视觉的模型。',
      };
    }
    const result = await visionProvider.analyzeImage({
      imageBuffer,
      mimeType,
      prompt,
      maxTokens,
      model: visionModel,
    });
    return result.success
      ? { ok: true, text: result.description }
      : { ok: false, text: `视觉分析失败: ${result.error}` };
  } catch (err) {
    return {
      ok: false,
      text: `视觉分析异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
