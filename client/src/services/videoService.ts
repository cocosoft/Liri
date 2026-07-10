/**
 * VideoService
 * 视频工具 API 封装层
 *
 * 通过 toolService.execute() 调用后端 video_generate 工具，
 * 通过 http.get/delete 调用视频列表/删除 API。
 */

import { toolService } from "./toolService";
import { http } from "./httpClient";
import type { ApiResponse } from "../types/api";

// 视频生成超时 10 分钟
const VIDEO_GENERATE_TIMEOUT = 600_000;

// ============================================================
// 类型定义
// ============================================================

export interface VideoGenerateParams {
  prompt: string;
  imagePath?: string;
  imageUrl?: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  style?: string;
  async?: boolean;
}

export interface VideoGenerateResult {
  success: boolean;
  video?: {
    url: string;
    prompt: string;
    duration: number;
    format: string;
  };
  videos?: Array<{
    url: string;
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
  }>;
  taskId?: string;
  status?: string;
  model?: string;
  durationMs?: number;
  error?: string;
}

/** 视频列表条目 */
export interface VideoListItem {
  path: string;
  url: string;
}

/** 视频列表响应 */
export interface VideoListResponse {
  videos: VideoListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 列表查询缓存（简单内存缓存，30s TTL） */
const listCache = new Map<string, { data: ApiResponse<VideoListResponse>; ts: number }>();
const LIST_CACHE_TTL = 30_000;

function withListCache(
  key: string,
  fetcher: () => Promise<ApiResponse<VideoListResponse>>
): Promise<ApiResponse<VideoListResponse>> {
  const cached = listCache.get(key);
  if (cached && Date.now() - cached.ts < LIST_CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  return fetcher().then((res) => {
    if (res.ok) {
      listCache.set(key, { data: res, ts: Date.now() });
    }
    return res;
  });
}

export const videoService = {
  /**
   * 视频生成（文生视频 / 图生视频）
   */
  async generate(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const raw = (await toolService.execute(
      "video_generate",
      { ...params },
      { timeout: VIDEO_GENERATE_TIMEOUT },
    )) as {
      success: boolean;
      data: VideoGenerateResult;
      error?: string;
      output?: string;
    };

    if (!raw?.success || !raw.data) {
      return {
        success: false,
        error: raw?.error || "Video generation failed",
      };
    }

    return raw.data;
  },

  /**
   * 列出已生成的视频（支持分页）
   */
  listVideos(params?: {
    page?: number;
    pageSize?: number;
    signal?: AbortSignal;
  }): Promise<VideoListResponse> {
    const { page = 1, pageSize = 50 } = params || {};
    const cacheKey = `listVideos-${page}-${pageSize}`;

    const fetcher = () =>
      http.get<VideoListResponse>(
        `/v1/videos/list?page=${page}&pageSize=${pageSize}`,
      );

    return withListCache(cacheKey, fetcher).then((res) => {
      if (!res.ok) {
        return { videos: [], total: 0, page, pageSize, hasMore: false };
      }
      return res.data as VideoListResponse;
    });
  },

  /**
   * 删除视频文件
   */
  async deleteVideo(path: string): Promise<boolean> {
    try {
      const res = await http.delete<{ success: boolean }>(
        `/v1/videos/delete?path=${encodeURIComponent(path)}`,
      );
      if (res.ok) {
        // 清除缓存
        listCache.clear();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  /**
   * 清除列表缓存（生成完成后调用）
   */
  clearListCache(): void {
    listCache.clear();
  },
};