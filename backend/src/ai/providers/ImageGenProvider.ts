/**
 * 图像生成提供商接口
 * 对标 Hermes ImageGenProvider ABC
 * 构建可插拔的图像生成提供商接口
 */

/**
 * 图像生成参数
 */
export interface ImageGenParams {
  /** 提示词 */
  prompt: string;
  /** 负面提示词 */
  negativePrompt?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 生成数量 */
  count?: number;
  /** 风格 */
  style?: string;
  /** 质量 */
  quality?: 'low' | 'medium' | 'high';
  /** 种子（可重复性） */
  seed?: number;
  /** 附加参数 */
  extra?: Record<string, unknown>;
}

/**
 * 图像生成结果
 */
export interface ImageGenResult {
  /** 是否成功 */
  success: boolean;
  /** 图片列表（base64 或 URL） */
  images: ImageData[];
  /** 使用量信息 */
  usage?: {
    generatedCount: number;
    estimatedTokens: number;
  };
  /** 错误信息 */
  error?: string;
  /** 模型名 */
  model?: string;
  /** 耗时 */
  durationMs: number;
}

/**
 * 图片数据
 */
export interface ImageData {
  /** 数据（base64）或 URL */
  data: string;
  /** 类型 */
  type: 'base64' | 'url';
  /** MIME 类型 */
  mimeType: string;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
}

/**
 * 图像生成提供商接口
 */
export interface ImageGenProvider {
  /** 提供商标识 */
  readonly id: string;
  /** 提供商名称 */
  readonly displayName: string;

  /**
   * 生成图像
   * @param params 生成参数
   * @returns 生成结果
   */
  generate(params: ImageGenParams): Promise<ImageGenResult>;

  /**
   * 列表支持的模型
   * @returns 模型名列表
   */
  listModels(): Promise<string[]>;

  /**
   * 健康检查
   * @returns 是否健康
   */
  healthCheck(): Promise<boolean>;
}

/**
 * 图像生成提供商注册表
 */
export class ImageGenProviderRegistry {
  private providers: Map<string, ImageGenProvider> = new Map();

  /**
   * 注册提供商
   * @param provider 提供商实例
   */
  register(provider: ImageGenProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 注销提供商
   * @param id 提供商 ID
   */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * 获取提供商
   * @param id 提供商 ID
   * @returns 提供商实例
   */
  get(id: string): ImageGenProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * 获取所有提供商
   * @returns 提供商列表
   */
  getAll(): ImageGenProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 使用指定提供商生成图像
   * @param providerId 提供商 ID
   * @param params 生成参数
   * @returns 生成结果
   */
  async generate(
    providerId: string,
    params: ImageGenParams
  ): Promise<ImageGenResult> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return {
        success: false,
        images: [],
        error: `提供商 ${providerId} 未注册`,
        durationMs: 0,
      };
    }

    return provider.generate(params);
  }
}

/**
 * 全局图像生成提供商注册表
 */
const globalRegistry = new ImageGenProviderRegistry();

/**
 * 获取全局图像生成提供商注册表
 * @returns ImageGenProviderRegistry 实例
 */
export function getImageGenProviderRegistry(): ImageGenProviderRegistry {
  return globalRegistry;
}
