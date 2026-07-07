// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话级图片上下文管理服务
 * 从 ChatManager 拆分出的独立模块，负责图片路径注册、路径匹配、上下文跟踪
 */
import path from 'node:path';

export interface ImageContext {
  lastGeneratedImage?: { filePath: string; prompt: string };
  lastEditedImage?: { filePath: string; action: string };
  lastAnalyzedImage?: { filePath: string; action: string };
}

export class ImageContextService {
  /** 会话级已知图片路径集合（用于执行工具前校验 inputPath） */
  private sessionImagePaths: Map<string, Set<string>> = new Map();

  /** 会话级图像上下文（用于跨轮对话中 AI 引用图片） */
  private sessionImageContext: Map<string, ImageContext> = new Map();

  /**
   * 注册会话的已知图片路径（工具调用前校验用）
   */
  registerImagePaths(sessionId: string, paths: string[]): void {
    if (!sessionId || paths.length === 0) return;
    let imagePaths = this.sessionImagePaths.get(sessionId);
    if (!imagePaths) {
      imagePaths = new Set<string>();
      this.sessionImagePaths.set(sessionId, imagePaths);
    }
    for (const p of paths) {
      if (p) imagePaths.add(p);
    }
  }

  /**
   * 获取会话的已知图片路径集合
   */
  getKnownImagePaths(sessionId: string): string[] {
    const paths = this.sessionImagePaths.get(sessionId);
    return paths ? Array.from(paths) : [];
  }

  /**
   * 在已知路径集合中查找最接近的路径
   * 使用文件名匹配：如果 AI 编造的路径中文件名与已知路径中的文件名一致，则返回已知路径
   */
  findClosestPath(inputPath: string, knownPaths: string[]): string | null {
    if (knownPaths.length === 0) return null;

    const inputBasename = path.basename(inputPath);
    for (const known of knownPaths) {
      if (path.basename(known) === inputBasename) {
        return known;
      }
    }

    return null;
  }

  /**
   * 从工具执行结果中提取图片文件路径
   * 支持 image_generate (images[].filePath)、image (outputPath)、image_analysis (无输出)
   */
  extractImagePathsFromResult(
    toolName: string,
    result: Record<string, unknown>
  ): string[] {
    const paths: string[] = [];

    if (toolName === 'image_generate') {
      const images = result.images as
        | Array<{ filePath?: string; localUrl?: string }>
        | undefined;
      if (Array.isArray(images)) {
        for (const img of images) {
          if (img.filePath) paths.push(img.filePath);
          if (img.localUrl) paths.push(img.localUrl);
        }
      }
    }

    if (toolName === 'image') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) paths.push(outputPath);
    }

    if (toolName === 'image_svg_generate') {
      const savePath = result.savePath as string | undefined;
      if (savePath) paths.push(savePath);
    }

    if (toolName === 'canvas') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) paths.push(outputPath);
    }

    return paths;
  }

  /**
   * 更新会话级图像上下文
   */
  updateImageContext(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>
  ): void {
    let ctx = this.sessionImageContext.get(sessionId);
    if (!ctx) {
      ctx = {};
      this.sessionImageContext.set(sessionId, ctx);
    }

    if (toolName === 'image_generate') {
      const images = result.images as Array<{ filePath?: string }> | undefined;
      if (Array.isArray(images) && images.length > 0 && images[0].filePath) {
        ctx.lastGeneratedImage = {
          filePath: images[0].filePath,
          prompt: (args.prompt as string) || '',
        };
      }
    }

    if (toolName === 'image') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) {
        ctx.lastEditedImage = {
          filePath: outputPath,
          action: (args.action as string) || '',
        };
      }
    }

    if (toolName === 'image_analysis') {
      const inputPath = args.inputPath as string | undefined;
      if (inputPath) {
        ctx.lastAnalyzedImage = {
          filePath: inputPath,
          action: (args.action as string) || '',
        };
      }
    }

    if (toolName === 'canvas') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) {
        ctx.lastEditedImage = {
          filePath: outputPath,
          action: (args.action as string) || 'export',
        };
      }
    }
  }

  /**
   * 构建图像上下文提示词（注入到系统提示词中）
   */
  buildImageContextPrompt(sessionId: string): string {
    const ctx = this.sessionImageContext.get(sessionId);
    if (!ctx) return '';

    const parts: string[] = [];

    if (ctx.lastGeneratedImage) {
      parts.push(
        `- 最近生成的图片: ${ctx.lastGeneratedImage.filePath} (提示词: ${ctx.lastGeneratedImage.prompt.slice(0, 100)})`
      );
    }
    if (ctx.lastEditedImage) {
      parts.push(
        `- 最近编辑的图片: ${ctx.lastEditedImage.filePath} (操作: ${ctx.lastEditedImage.action})`
      );
    }
    if (ctx.lastAnalyzedImage) {
      parts.push(
        `- 最近分析的图片: ${ctx.lastAnalyzedImage.filePath} (操作: ${ctx.lastAnalyzedImage.action})`
      );
    }

    if (parts.length === 0) return '';

    return (
      `\n## 当前会话图像上下文\n以下是本会话中最近操作的图片，用户可能用"这张图""刚才那张图"等指代：\n` +
      parts.join('\n') +
      `\n调用图像工具时，请使用上述真实路径作为 inputPath，不要编造路径。\n`
    );
  }

  /**
   * 获取图像上下文（用于外部读取）
   */
  getImageContext(sessionId: string): ImageContext | undefined {
    return this.sessionImageContext.get(sessionId);
  }
}
