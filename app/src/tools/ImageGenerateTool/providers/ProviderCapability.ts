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
 * ProviderCapability — 图像生成 Provider 能力声明类型
 *
 * 每个生图 Provider 必须声明其能力边界（支持的尺寸、纵横比、分辨率等），
 * 工具层根据能力动态调整暴露的参数，隐藏不支持的选项。
 *
 * 参照：openclaw src/image-generation/types.ts
 */

// ============================================================
// 能力声明核心类型
// ============================================================

/** 模型条目 */
export interface ModelEntry {
  id: string;
  displayName: string;
}

/** 预设尺寸 */
export type SizePreset =
  | 'square_hd'
  | 'landscape_4_3'
  | 'portrait_4_3'
  | 'landscape_16_9'
  | 'portrait_16_9'
  | string;

/** 纵横比 */
export type AspectRatio =
  | '1:1'
  | '4:3'
  | '16:9'
  | '9:16'
  | '3:2'
  | '2:3'
  | string;

/** 分辨率档位 */
export type Resolution = '1K' | '2K' | '4K' | string;

/** 输出格式 */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** Provider 特性开关 */
export interface ProviderFeatures {
  /** 是否支持负面提示词 */
  negativePrompt: boolean;
  /** 是否支持风格预设 */
  style: boolean;
  /** 是否支持品质档位（standard / hd） */
  quality: boolean;
  /** 是否支持透明背景 */
  background: boolean;
  /** 是否支持参考图编辑（img2img） */
  imageEditing: boolean;
  /** 编辑模式最大输入图数（0 表示不支持编辑） */
  maxInputImages: number;
}

/** 图像生成 Provider 能力声明 */
export interface ImageGenCapability {
  /** 支持的模型列表 */
  models: ModelEntry[];
  /** 单次最大生成数量 */
  maxCount: number;
  /** 支持的预设尺寸 */
  supportedSizes: SizePreset[];
  /** 支持的预设纵横比 */
  supportedAspectRatios: AspectRatio[];
  /** 支持的分辨率档位 */
  supportedResolutions: Resolution[];
  /** 支持的输出格式 */
  outputFormats: ImageFormat[];
  /** 特性开关 */
  features: ProviderFeatures;
}

// ============================================================
// 开放 AI 兼容 Provider 的默认能力
// ============================================================

/** DALL-E 3 / GPT-Image 等 OpenAI 生图模型的默认能力 */
export const DEFAULT_OPENAI_IMAGE_CAPABILITY: ImageGenCapability = {
  models: [{ id: 'dall-e-3', displayName: 'DALL-E 3' }],
  maxCount: 1,
  supportedSizes: ['square_hd', 'landscape_16_9', 'portrait_16_9'],
  supportedAspectRatios: ['1:1', '16:9', '9:16'],
  supportedResolutions: ['1K', '2K'],
  outputFormats: ['png', 'webp'],
  features: {
    negativePrompt: false,
    style: true,
    quality: true,
    background: false,
    imageEditing: false,
    maxInputImages: 0,
  },
};

/** FAL.ai 的默认能力 */
export const DEFAULT_FAL_CAPABILITY: ImageGenCapability = {
  models: [
    { id: 'fal-ai/flux/dev', displayName: 'FLUX.1 [dev]' },
    { id: 'fal-ai/flux-pro/v1.5', displayName: 'FLUX.1 [pro]' },
    { id: 'fal-ai/flux-klein/v9', displayName: 'FLUX.2 Klein 9B' },
    { id: 'fal-ai/z-image-turbo', displayName: 'Z-Image Turbo' },
    { id: 'fal-ai/ideogram/v3', displayName: 'Ideogram V3' },
  ],
  maxCount: 4,
  supportedSizes: ['square_hd', 'landscape_4_3', 'portrait_4_3'],
  supportedAspectRatios: ['1:1', '4:3', '3:4'],
  supportedResolutions: ['1K', '2K'],
  outputFormats: ['png', 'jpeg', 'webp'],
  features: {
    negativePrompt: true,
    style: false,
    quality: false,
    background: false,
    imageEditing: false,
    maxInputImages: 0,
  },
};

/** Stability AI 的默认能力 */
export const DEFAULT_STABILITY_CAPABILITY: ImageGenCapability = {
  models: [
    { id: 'stable-diffusion-3.5-large', displayName: 'SD 3.5 Large' },
    { id: 'core', displayName: 'Stable Image Core' },
  ],
  maxCount: 1,
  supportedSizes: ['square_hd', 'landscape_16_9', 'portrait_16_9'],
  supportedAspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
  supportedResolutions: ['1K', '2K'],
  outputFormats: ['png', 'jpeg', 'webp'],
  features: {
    negativePrompt: true,
    style: true,
    quality: false,
    background: false,
    imageEditing: false,
    maxInputImages: 0,
  },
};

// ============================================================
// 校验函数
// ============================================================

/** 参数校验结果 */
export interface CapabilityValidationResult {
  valid: boolean;
  violations: string[];
  /** 剔除不支持的参数后的安全 params */
  safeParams?: Partial<Record<string, unknown>>;
}

/**
 * 根据 Provider 能力校验并净化生图参数
 *
 * 不支持的参数自动剔除（返回 safeParams），避免 Provider API 因未知参数报错。
 * 参照 hermes 的 supports 白名单模式。
 */
export function validateAgainstCapability(
  capability: ImageGenCapability,
  params: Record<string, unknown>
): CapabilityValidationResult {
  const violations: string[] = [];

  // 校验生成数量
  const n = Number(params.n ?? 1);
  if (n > capability.maxCount) {
    violations.push(`n=${n} 超过 Provider 最大限制 ${capability.maxCount}`);
  }

  // 校验格式
  const format = params.format as string | undefined;
  if (format && !capability.outputFormats.includes(format as ImageFormat)) {
    violations.push(
      `输出格式 '${format}' 不被支持，可用: ${capability.outputFormats.join(', ')}`
    );
  }

  // 校验品质
  if (params.quality && !capability.features.quality) {
    violations.push('品质参数不在 Provider 能力范围');
  }

  // 校验风格
  if (params.style && !capability.features.style) {
    violations.push('风格参数不在 Provider 能力范围');
  }

  // 校验负面提示词
  if (params.negativePrompt && !capability.features.negativePrompt) {
    violations.push('负面提示词不在 Provider 能力范围');
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
