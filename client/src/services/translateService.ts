/**
 * 翻译 API 服务
 *
 * 封装 /v1/translate 和 /v1/translate/history 的 HTTP 调用。
 */

import { httpLegacy as http } from "./httpClient";
import { getBackendBaseUrl, getApiSecret } from "./backendUrl";
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
    const baseUrl = getBackendBaseUrl().replace(/\/+$/, "");
    const url = `${baseUrl}/v1/translate/stream`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    const secret = getApiSecret();
    if (secret) {
      headers["X-API-Key"] = secret;
    }

    const controller = new AbortController();
    let retryCount = 0;

    const doFetch = async (): Promise<void> => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(params),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          onError(`HTTP ${res.status}: ${text.slice(0, 200)}`, false);
          return;
        }

        if (!res.body) {
          onError("响应体为空", false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            try {
              const chunk = JSON.parse(trimmed.slice(6));
              if (chunk.type === "token") {
                onToken(chunk.token);
              } else if (chunk.type === "done") {
                onDone(chunk.result);
                retryCount = 0; // 成功，重置
              } else if (chunk.type === "error") {
                onError(chunk.message, true);
              }
            } catch (e) {
              handleClientError(e, { module: "services:translate", action: "streamTranslate-parseLine" });
              // 跳过无法解析的行
            }
          }
        }
      } catch (err) {
        handleClientError(err, { module: "services:translate", action: "streamTranslate-fetch" });
        if ((err as Error).name === "AbortError") return;

        // 自动重试 1 次
        if (retryCount < 1 && !controller.signal.aborted) {
          retryCount++;
          await new Promise((r) => setTimeout(r, 200));
          return doFetch();
        }

        onError(
          (err as Error).message || "流式翻译失败",
          retryCount > 0, // 已重试过，允许降级
        );
      }
    };

    doFetch();

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
