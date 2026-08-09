/**
 * VideoService
 * 视频工具 API 封装层
 *
 * 通过 toolService.execute() 调用后端 video_generate 工具，
 * 通过 http.get/delete 调用视频列表/删除 API。
 */

import { toolService } from "./toolService";
import { http } from "./httpClient";
import type { ApiResponse } from "../types/system";

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
const listCache = new Map<
  string,
  { data: ApiResponse<VideoListResponse>; ts: number }
>();
const LIST_CACHE_TTL = 30_000;

function withListCache(
  key: string,
  fetcher: () => Promise<ApiResponse<VideoListResponse>>,
): Promise<ApiResponse<VideoListResponse>> {
  const cached = listCache.get(key);
  if (cached && Date.now() - cached.ts < LIST_CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  return fetcher()
    .then((res) => {
      if (res.ok) {
        listCache.set(key, { data: res, ts: Date.now() });
      }
      return res;
    })
    .catch((err) => {
      return {
        ok: false,
        error: { code: 0, message: String(err) },
        data: null as unknown as VideoListResponse,
      };
    });
}

/** 视频任务详情 */
interface VideoTaskDetail {
  taskId: string;
  status: "pending" | "queued" | "running" | "completed" | "failed";
  mode?: string;
  progress?: number;
  sourceImageUrl?: string | null;
  resultVideoUrl?: string | null;
  prompt?: string;
  error?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}

/** 视频任务列表响应 */
interface VideoTaskListResponse {
  tasks: VideoTaskDetail[];
  total: number;
  hasMore: boolean;
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

    return withListCache(cacheKey, fetcher)
      .then((res) => {
        if (!res.ok) {
          return { videos: [], total: 0, page, pageSize, hasMore: false };
        }
        return res.data as VideoListResponse;
      })
      .catch(() => {
        return { videos: [], total: 0, page, pageSize, hasMore: false };
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
        listCache.clear();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  // ============================================================
  // Phase 1: 异步任务 API
  // ============================================================

  /**
   * 创建异步视频生成任务
   */
  async createVideoTask(params: {
    mode?: "text-to-video" | "image-to-video";
    prompt: string;
    imageUrl?: string;
    duration?: number;
    aspectRatio?: string;
    modelId?: string;
  }): Promise<{ taskId: string; status: string }> {
    const res = await http.post<{ taskId: string; status: string }>(
      "/v1/video/tasks",
      params,
    );
    if (!res.ok) {
      throw new Error(String(res.error || "创建任务失败"));
    }
    return res.data as { taskId: string; status: string };
  },

  /**
   * 查询单个任务状态
   */
  async getVideoTask(taskId: string): Promise<{
    taskId: string;
    status: "pending" | "queued" | "running" | "completed" | "failed";
    mode?: string;
    progress?: number;
    sourceImageUrl?: string | null;
    resultVideoUrl?: string | null;
    prompt?: string;
    error?: string | null;
    createdAt?: string;
    completedAt?: string | null;
  }> {
    const res = await http.get<VideoTaskDetail>(
      `/v1/video/tasks/${encodeURIComponent(taskId)}`,
    );
    if (!res.ok) {
      throw new Error(String(res.error || "查询任务失败"));
    }
    return res.data as unknown as VideoTaskDetail;
  },

  /**
   * 查询任务列表
   */
  async listVideoTasks(params?: {
    status?: "active" | "all";
    limit?: number;
    offset?: number;
  }): Promise<{
    tasks: Array<{
      taskId: string;
      status: string;
      mode?: string;
      progress?: number;
      sourceImageUrl?: string | null;
      resultVideoUrl?: string | null;
      prompt?: string;
      error?: string | null;
      createdAt?: string;
      completedAt?: string | null;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const res = await http.get<VideoTaskListResponse>(
      `/v1/video/tasks?${query.toString()}`,
    );
    if (!res.ok) {
      throw new Error(String(res.error || "查询任务列表失败"));
    }
    return res.data as unknown as VideoTaskListResponse;
  },

  /**
   * 清除列表缓存（生成完成后调用）
   */
  clearListCache(): void {
    listCache.clear();
  },
};
