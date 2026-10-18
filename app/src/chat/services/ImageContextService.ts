// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话级图片上下文管理服务
 * 从 ChatManager 拆分出的独立模块，负责图片路径注册、路径匹配、上下文跟踪
 */
import path from 'path';
import { SessionConfirmedPaths } from './SessionConfirmedPaths';
import {
  collectMediaArtifactPaths,
  mediaArtifactDetail,
  primaryMediaArtifact,
  resolveMediaArtifacts,
} from '@modules/utils/toolContract/mediaArtifacts';

export interface ImageContext {
  lastGeneratedImage?: { filePath: string; prompt: string };
  lastEditedImage?: { filePath: string; action: string };
  lastAnalyzedImage?: { filePath: string; action: string };
}

export class ImageContextService {
  /** 会话级已知图片路径集合（委托给 SessionConfirmedPaths，方案 4） */
  private sessionImagePaths: Map<string, Set<string>> = new Map();

  /** 通用已确认路径集合（方案 4 — 供 PathGuardService 校验用） */
  readonly confirmedPaths: SessionConfirmedPaths = new SessionConfirmedPaths();

  /** 会话级图像上下文（用于跨轮对话中 AI 引用图片） */
  private sessionImageContext: Map<string, ImageContext> = new Map();

  /**
   * 注册会话的已知图片路径（工具调用前校验用）
   * 同时注册到通用 confirmedPaths 集合
   */
  registerImagePaths(sessionId: string, paths: string[]): void {
    if (!sessionId || paths.length === 0) return;
    let imagePaths = this.sessionImagePaths.get(sessionId);
    if (!imagePaths) {
      imagePaths = new Set<string>();
      this.sessionImagePaths.set(sessionId, imagePaths);
    }
    for (const p of paths) {
      if (p) {
        imagePaths.add(p);
        this.confirmedPaths.add(p);
      }
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
   *
   * A-4（2026-10-18）：产物结构由 `TOOL_MEDIA_ARTIFACTS`（`tools/mediaArtifacts.ts`）声明，
   * 本方法只做「按声明取值」，**不再按工具名分支** —— 新增媒体工具只改声明表。
   */
  extractImagePathsFromResult(
    toolName: string,
    result: Record<string, unknown>
  ): string[] {
    const spec = resolveMediaArtifacts(toolName);
    return spec ? collectMediaArtifactPaths(result, spec) : [];
  }

  /**
   * 更新会话级图像上下文
   *
   * A-4（2026-10-18）：槽位（generated / edited / analyzed）与补充字段同样由声明表给出；
   * 未登记的工具只创建空上下文（与原行为一致：调用方对**每个**成功工具调用都会调用本方法）。
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

    const spec = resolveMediaArtifacts(toolName);
    if (!spec?.contextSlot) return;

    const inputPathKey = spec.inputPathKey;
    const inputPath = inputPathKey ? args[inputPathKey] : undefined;
    const filePath =
      typeof inputPath === 'string' && inputPath
        ? inputPath
        : primaryMediaArtifact(result, spec);
    if (!filePath) return;

    const detail = mediaArtifactDetail(args, spec);
    if (spec.contextSlot === 'generated') {
      ctx.lastGeneratedImage = { filePath, prompt: detail };
    } else if (spec.contextSlot === 'analyzed') {
      ctx.lastAnalyzedImage = { filePath, action: detail };
    } else {
      ctx.lastEditedImage = { filePath, action: detail };
    }
  }

  /**
   * 构建图像上下文提示词（注入到系统提示词中）
   */
  buildImageContextPrompt(sessionId: string): string {
    const ctx = this.sessionImageContext.get(sessionId);
    const knownPaths = this.getKnownImagePaths(sessionId);

    const parts: string[] = [];

    // 用户上传的图片/附件路径（供 AI 在 image_analysis 等工具中引用）
    if (knownPaths.length > 0) {
      parts.push(`- 用户上传的图片/附件路径: ${knownPaths.join(', ')}`);
    }

    if (ctx?.lastGeneratedImage) {
      parts.push(
        `- 最近生成的图片: ${ctx.lastGeneratedImage.filePath} (提示词: ${ctx.lastGeneratedImage.prompt.slice(0, 100)})`
      );
    }
    if (ctx?.lastEditedImage) {
      parts.push(
        `- 最近编辑的图片: ${ctx.lastEditedImage.filePath} (操作: ${ctx.lastEditedImage.action})`
      );
    }
    if (ctx?.lastAnalyzedImage) {
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
