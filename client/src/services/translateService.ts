/**
 * 翻译 API 服务
 *
 * 封装 /v1/translate 和 /v1/translate/history 的 HTTP 调用。
 */

import { httpLegacy as http, http as apiHttp } from "./httpClient";
import { handleClientError } from "../utils/handleError";

/** 翻译请求参数 */
export interface TranslateParams {
  text: string;
  sourceLang: string;
  targetLang: string;
  model?: string;
}

/** 翻译结果 */
export interface TranslateResult {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  durationMs: number;
  /** 语言检测置信度（0-1），仅自动检测时有值 */
  confidence?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  createdAt: number;
}

/** 翻译历史记录 */
export interface TranslateHistoryRecord {
  id: string;
  groupId: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  durationMs: number;
  usageJson: string | null;
  starred: boolean;
  createdAt: number;
}

/** 翻译历史分页结果 */
export interface TranslateHistoryPage {
  records: TranslateHistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** 备选翻译条目 */
export interface AlternativeTranslation {
  translation: string;
  pos?: string;
  score: number;
}

/** 备选翻译结果 */
export interface AlternativesResult {
  alternatives: AlternativeTranslation[];
}

export const translateService = {
  /** 执行翻译 */
  async translate(params: TranslateParams): Promise<TranslateResult> {
    const response = await http.post<{ data: TranslateResult }>(
      "/v1/translate",
      params,
    );
    return response.data;
  },

  /**
   * 流式翻译（SSE）
   *
   * 通过 POST /v1/translate/stream 发送请求，SSE 流式接收 token。
   * 支持自动重连 1 次（200ms delay），失败后降级。
   * 返回 AbortController 用于取消流。
   */
  streamTranslate(
    params: TranslateParams,
    onToken: (token: string) => void,
    onDone: (result: TranslateResult) => void,
    onError: (error: string, canFallback: boolean) => void,
  ): AbortController {
    // W6 收尾（2026-08-31）：改走统一 http.stream——Tauri 下经 Rust http_proxy_stream
    // 注入密钥（原直连 fetch 依赖 getApiSecret，BackendStatus.secret 回收后恒空）。
    // 后端 translate/stream 每条事件以空行结束（data: {json}\n\n），与 http.stream
    // 按事件边界解析兼容。自动重试 1 次逻辑保留。
    const controller = new AbortController();
    let retryCount = 0;
    let active: AbortController | null = null;
    controller.signal.addEventListener("abort", () => active?.abort());

    const start = (): void => {
      apiHttp
        .stream(
          "/v1/translate/stream",
          (payload) => {
            try {
              const chunk = JSON.parse(payload) as {
                type?: string;
                token?: string;
                result?: TranslateResult;
                message?: string;
              };
              if (chunk.type === "token") {
                onToken(chunk.token ?? "");
              } else if (chunk.type === "done") {
                onDone(chunk.result as TranslateResult);
                retryCount = 0; // 成功，重置
              } else if (chunk.type === "error") {
                onError(chunk.message ?? "翻译失败", true);
              }
            } catch (e) {
              handleClientError(e, {
                module: "services:translate",
                action: "streamTranslate-parseChunk",
              });
            }
          },
          {
            method: "POST",
            body: params,
            onError: (err) => {
              if (controller.signal.aborted) return;
              // 自动重试 1 次（200ms delay）
              if (retryCount < 1) {
                retryCount++;
                setTimeout(start, 200);
                return;
              }
              onError(
                err instanceof Error ? err.message : String(err),
                true, // 已重试过，允许降级
              );
            },
          },
        )
        .then((ctrl) => {
          active = ctrl;
          if (controller.signal.aborted) ctrl.abort();
        })
        .catch(() => {
          // 流创建失败已由 onError 回调处理
        });
    };

    start();
    return controller;
  },

  /** 查询翻译历史（支持搜索、收藏筛选） */
  async getHistory(params?: {
    page?: number;
    pageSize?: number;
    sourceLang?: string;
    targetLang?: string;
    search?: string;
    starred?: boolean;
  }): Promise<TranslateHistoryPage> {
    const response = await http.get<{ data: TranslateHistoryPage }>(
      "/v1/translate/history",
      { params },
    );
    return response.data;
  },

  /** 切换收藏状态 */
  async toggleStar(id: string): Promise<boolean> {
    const response = await http.post<{ data: { starred: boolean } }>(
      `/v1/translate/history/${id}/star`,
    );
    return response.data.starred;
  },

  /** 批量删除历史记录 */
  async deleteByIds(ids: string[]): Promise<number> {
    const response = await http.post<{ data: { deleted: number } }>(
      "/v1/translate/history/delete",
      { ids },
    );
    return response.data.deleted;
  },

  /** 获取备选翻译 */
  async getAlternatives(params: {
    word: string;
    sourceLang: string;
    targetLang: string;
    context?: string;
  }): Promise<AlternativesResult> {
    const response = await http.post<{ data: AlternativesResult }>(
      "/v1/translate/alternatives",
      params,
    );
    return response.data;
  },

  /** 导出历史为 JSON */
  async exportJSON(params?: {
    sourceLang?: string;
    targetLang?: string;
  }): Promise<TranslateHistoryRecord[]> {
    const response = await http.get<{ data: TranslateHistoryRecord[] }>(
      "/v1/translate/history/export",
      { params },
    );
    return response.data;
  },
};
