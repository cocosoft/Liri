import type { FAQEntry, FAQImportReport } from "../types/knowledge";
import { http } from "./httpClient";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export const faqService = {
  /** 列出 FAQ 条目 */
  list: async (
    base: string,
    params?: { category?: string; offset?: number; limit?: number },
  ): Promise<{
    entries: FAQEntry[];
    total: number;
    offset: number;
    limit: number;
  }> => {
    const sp = new URLSearchParams();
    if (params?.category) sp.set("category", params.category);
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const url = qs
      ? `/v1/knowledge/${encodeURIComponent(base)}/faq?${qs}`
      : `/v1/knowledge/${encodeURIComponent(base)}/faq`;
    const res = await http.get<{
      entries: FAQEntry[];
      total: number;
      offset: number;
      limit: number;
    }>(url);
    return unwrap(res, "FAQ_LIST");
  },

  /** 创建 FAQ 条目 */
  create: async (
    base: string,
    entry: {
      question: string;
      answer: string;
      similarQuestions?: string[];
      tags?: string[];
      category?: string;
      recommended?: boolean;
    },
  ): Promise<FAQEntry> => {
    const res = await http.post<FAQEntry>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq`,
      entry,
    );
    return unwrap(res, "FAQ_CREATE");
  },

  /** 更新 FAQ 条目 */
  update: async (
    base: string,
    id: string,
    updates: Partial<FAQEntry>,
  ): Promise<FAQEntry> => {
    const res = await http.put<FAQEntry>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/${id}`,
      updates,
    );
    return unwrap(res, "FAQ_UPDATE");
  },

  /** 删除 FAQ 条目 */
  delete: async (base: string, id: string): Promise<void> => {
    const res = await http.delete<unknown>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/${id}`,
    );
    unwrap(res, "FAQ_DELETE");
  },

  /** 批量删除 FAQ 条目 */
  batchDelete: async (
    base: string,
    ids: string[],
  ): Promise<{ deleted: number }> => {
    const res = await http.post<{ deleted: number }>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/batch-delete`,
      { ids },
    );
    return unwrap(res, "FAQ_BATCH_DELETE");
  },

  /** 批量导入 FAQ */
  import: async (
    base: string,
    format: "csv" | "json",
    data: string,
  ): Promise<FAQImportReport> => {
    const res = await http.post<FAQImportReport>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/import`,
      { format, data },
    );
    return unwrap(res, "FAQ_IMPORT");
  },

  /** 搜索 FAQ */
  search: async (
    base: string,
    query: string,
  ): Promise<{ entries: FAQEntry[]; total: number }> => {
    const res = await http.get<{ entries: FAQEntry[]; total: number }>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/search?q=${encodeURIComponent(query)}`,
    );
    return unwrap(res, "FAQ_SEARCH");
  },

  /** 获取 FAQ 分类列表 */
  categories: async (base: string): Promise<string[]> => {
    const res = await http.get<{ categories: string[] }>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq/categories`,
    );
    return unwrap(res, "FAQ_CATEGORIES").categories;
  },

  /** 获取计数 */
  count: async (base: string): Promise<number> => {
    const res = await http.get<{ total: number }>(
      `/v1/knowledge/${encodeURIComponent(base)}/faq?limit=1`,
    );
    return res.ok ? (res.data?.total ?? 0) : 0;
  },
};
