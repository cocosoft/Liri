import type {
  KnowledgeItem,
  KnowledgeSearchResult,
  KnowledgeSearchHit,
  KnowledgeBase,
  KnowledgeFile,
} from "../types";
import { http } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

// ─── 工具 ────────────────────────────────────────────────

/** 从 ApiResponse 解包，失败时抛 Error（服务层职责边界） */
function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok) {
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  }
  return res.data as T;
}

// ─── knowledgeService ────────────────────────────────────

export const knowledgeService = {
  list: (): Promise<KnowledgeItem[]> => {
    return getOTelTracing().asyncWrap("services:knowledge:list", async () => {
      const res = await http.get<{ items: KnowledgeItem[]; total: number }>(
        "/v1/knowledge",
      );
      const data = unwrap(res, "KNOWLEDGE_LIST");
      return Array.isArray(data) ? data : (data.items ?? []);
    });
  },

  get: async (id: string): Promise<KnowledgeItem | null> => {
    const res = await http.get<KnowledgeItem | null>(`/v1/knowledge/${id}`);
    return unwrap(res, "KNOWLEDGE_GET");
  },

  create: async (
    item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">,
  ): Promise<KnowledgeItem> => {
    const res = await http.post<KnowledgeItem>("/v1/knowledge", item);
    return unwrap(res, "KNOWLEDGE_CREATE");
  },

  update: async (
    id: string,
    updates: Partial<KnowledgeItem>,
  ): Promise<KnowledgeItem> => {
    const res = await http.put<KnowledgeItem>(`/v1/knowledge/${id}`, updates);
    return unwrap(res, "KNOWLEDGE_UPDATE");
  },

  delete: async (id: string): Promise<void> => {
    const res = await http.delete<unknown>(`/v1/knowledge/${id}`);
    unwrap(res, "KNOWLEDGE_DELETE");
  },

  search: (query: string): Promise<KnowledgeItem[]> => {
    return getOTelTracing().asyncWrap("services:knowledge:search", async () => {
      const res = await http.post<KnowledgeItem[]>("/v1/knowledge/search", {
        query,
      });
      return unwrap(res, "KNOWLEDGE_SEARCH");
    });
  },

  hybridSearch: async (
    query: string,
    base?: string,
    domain?: string,
    tags?: string[],
  ): Promise<KnowledgeSearchHit[]> => {
    const params = new URLSearchParams();
    if (base) params.set("base", base);
    if (domain) params.set("domain", domain);
    if (tags && tags.length > 0) params.set("tags", tags.join(","));
    const qs = params.toString();
    const url = qs ? `/v1/knowledge/search?${qs}` : "/v1/knowledge/search";
    const res = await http.post<KnowledgeSearchResult[]>(url, { query, tags });
    const results = unwrap(res, "KNOWLEDGE_HYBRID_SEARCH");
    return results.map((r) => ({
      file: {
        id: r.id,
        title: r.title,
        content: r.content,
        tags: r.tags ?? [],
        category: r.category,
        docPath: r.docPath,
        size: 0,
        updated_at: 0,
        created_at: 0,
        source: "manual" as const,
        base: base ?? "",
      },
      score: r.score,
      matchType: (r.matchType as KnowledgeSearchHit["matchType"]) ?? "keyword",
      snippet: r.content.slice(0, 200),
    }));
  },

  /** 获取增强知识列表（支持按知识库过滤，返回完整文件元数据） */
  listFiles: async (
    base?: string,
    offset?: number,
    limit?: number,
  ): Promise<{ items: KnowledgeFile[]; total: number }> => {
    const params = new URLSearchParams();
    if (base) params.set("base", base);
    if (offset !== undefined) params.set("offset", String(offset));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const url = qs ? `/v1/knowledge?${qs}` : "/v1/knowledge";
    const res = await http.get<{ items: KnowledgeFile[]; total: number }>(url);
    return unwrap(res, "KNOWLEDGE_LIST_FILES");
  },

  listBases: async (): Promise<KnowledgeBase[]> => {
    const res = await http.get<KnowledgeBase[]>("/v1/knowledge/bases");
    return unwrap(res, "KNOWLEDGE_LIST_BASES");
  },

  createBase: async (
    name: string,
    label: string,
    icon?: string,
  ): Promise<KnowledgeBase> => {
    const res = await http.post<KnowledgeBase>("/v1/knowledge/bases", {
      name,
      label,
      icon,
    });
    return unwrap(res, "KNOWLEDGE_CREATE_BASE");
  },

  updateBase: async (
    name: string,
    updates: Partial<KnowledgeBase>,
  ): Promise<KnowledgeBase> => {
    const res = await http.put<KnowledgeBase>(
      `/v1/knowledge/bases/${encodeURIComponent(name)}`,
      updates,
    );
    return unwrap(res, "KNOWLEDGE_UPDATE_BASE");
  },

  deleteBase: async (name: string): Promise<void> => {
    const res = await http.delete<unknown>(
      `/v1/knowledge/bases/${encodeURIComponent(name)}`,
    );
    unwrap(res, "KNOWLEDGE_DELETE_BASE");
  },

  /** 克隆知识库（深拷贝，含文档和索引） */
  cloneBase: async (name: string, newName: string): Promise<KnowledgeBase> => {
    const res = await http.post<KnowledgeBase>(
      `/v1/knowledge/bases/${encodeURIComponent(name)}/clone`,
      { newName },
    );
    return unwrap(res, "KNOWLEDGE_CLONE_BASE");
  },

  /** 复制知识库配置（浅拷贝，仅配置不含文档） */
  duplicateBase: async (
    name: string,
    newName: string,
  ): Promise<KnowledgeBase> => {
    const res = await http.post<KnowledgeBase>(
      `/v1/knowledge/bases/${encodeURIComponent(name)}/duplicate`,
      { newName },
    );
    return unwrap(res, "KNOWLEDGE_DUPLICATE_BASE");
  },

  saveFromChat: async (params: {
    base?: string;
    title: string;
    content: string;
    sessionId?: string;
  }): Promise<{ success: boolean; docPath: string; title: string }> => {
    const res = await http.post<{
      success: boolean;
      docPath: string;
      title: string;
    }>("/v1/knowledge/save-from-chat", params);
    return unwrap(res, "KNOWLEDGE_SAVE_FROM_CHAT");
  },

  /** 获取待编译的 raw 文件列表 */
  getRawFiles: async (): Promise<{
    files: Array<{
      fileName: string;
      ext: string;
      size: number;
      modifiedAt: number;
      createdAt: number;
      category: string | null;
      source: string | null;
    }>;
    totalCount: number;
  }> => {
    const res = await http.get<{
      files: Array<{
        fileName: string;
        ext: string;
        size: number;
        modifiedAt: number;
        createdAt: number;
        category: string | null;
        source: string | null;
      }>;
      totalCount: number;
    }>("/v1/knowledge/raw-files");
    return unwrap(res, "KNOWLEDGE_RAW_FILES");
  },

  /** 更新知识库文档内容（保留 frontmatter 元数据） */
  updateDoc: async (
    docPath: string,
    content: string,
    title?: string,
    extra?: { tags?: string[]; category?: string; base?: string },
  ): Promise<{ docPath: string; updatedAt: string }> => {
    const body: Record<string, unknown> = { docPath, content };
    if (title !== undefined) body.title = title;
    if (extra?.tags !== undefined) body.tags = extra.tags;
    if (extra?.category !== undefined) body.category = extra.category;
    if (extra?.base !== undefined) body.base = extra.base;
    const res = await http.put<{ docPath: string; updatedAt: string }>(
      "/v1/knowledge/docs",
      body,
    );
    return unwrap(res, "KNOWLEDGE_UPDATE_DOC");
  },

  /** 上传文件到指定知识库 */
  uploadToBase: (
    baseName: string,
    file: { name: string; data: string },
    tags?: string[],
  ): Promise<{ docPath: string; title: string; size: number }> => {
    return getOTelTracing().asyncWrap("services:knowledge:upload", async () => {
      try {
        const res = await http.post<{
          docPath: string;
          title: string;
          size: number;
        }>("/v1/knowledge/upload", {
          baseName,
          ...file,
          tags,
        });
        return unwrap(res, "KNOWLEDGE_UPLOAD");
      } catch (err) {
        handleClientError(err, {
          module: "services:knowledge",
          action: "uploadToBase",
        });
        throw err;
      }
    });
  },

  /** 触发知识库编译 */
  triggerCompile: async (
    force?: boolean,
  ): Promise<{ compiled: number; skipped: number; errors: string[] }> => {
    const res = await http.post<{
      compiled: number;
      skipped: number;
      errors: string[];
    }>("/v1/knowledge/compile", { force });
    return unwrap(res, "KNOWLEDGE_COMPILE");
  },

  /** W9: 获取编译进度 */
  getCompileStatus: async (): Promise<{
    status: "idle" | "compiling" | "done";
    current: number;
    total: number;
    startedAt: number;
    lastError: string | null;
  }> => {
    const res = await http.get<{
      status: "idle" | "compiling" | "done";
      current: number;
      total: number;
      startedAt: number;
      lastError: string | null;
    }>("/v1/knowledge/compile-status");
    return unwrap(res, "KNOWLEDGE_COMPILE_STATUS");
  },

  /** 将知识文档导出到 Notebook 兼容格式 */
  exportToNotebook: async (
    docPath: string,
    title?: string,
  ): Promise<{ exportPath: string; fileName: string; size: number }> => {
    const res = await http.post<{
      exportPath: string;
      fileName: string;
      size: number;
    }>("/v1/knowledge/export-to-notebook", {
      docPath,
      title,
    });
    return unwrap(res, "KNOWLEDGE_EXPORT_NOTEBOOK");
  },

  /** 从外部文件导入知识文档 */
  importFromFile: async (
    filePath: string,
    baseName?: string,
    tags?: string[],
  ): Promise<{ docPath: string; title: string; size: number }> => {
    const res = await http.post<{
      docPath: string;
      title: string;
      size: number;
    }>("/v1/knowledge/import-from-file", {
      filePath,
      baseName,
      tags,
    });
    return unwrap(res, "KNOWLEDGE_IMPORT_FILE");
  },

  /** 批量删除知识文档 */
  batchDelete: async (ids: string[]): Promise<{ deleted: number }> => {
    const res = await http.post<{ deleted: number }>(
      "/v1/knowledge/batch-delete",
      { ids },
    );
    return unwrap(res, "KNOWLEDGE_BATCH_DELETE");
  },

  /** 批量添加标签到知识文档 */
  batchTag: async (
    ids: string[],
    tags: string[],
  ): Promise<{ updated: number }> => {
    const res = await http.post<{ updated: number }>(
      "/v1/knowledge/batch-tag",
      { ids, tags },
    );
    return unwrap(res, "KNOWLEDGE_BATCH_TAG");
  },

  /** 列出文档的快照版本 */
  listSnapshots: async (title: string): Promise<string[]> => {
    const res = await http.get<{ snapshots: string[] }>(
      `/v1/knowledge/snapshots?title=${encodeURIComponent(title)}`,
    );
    if (!res.ok) {
      // 400 表示无快照，返回空数组
      if (res.error?.code === 400) return [];
      throw new Error(
        `[KNOWLEDGE_SNAPSHOTS] ${res.error?.message ?? "未知错误"}`,
      );
    }
    return res.data?.snapshots ?? [];
  },

  /** W6: 获取快照内容 */
  getSnapshotContent: async (
    title: string,
    snapshot: string,
  ): Promise<string | null> => {
    const snapDir = `.knowledge-snapshots/${title}/${snapshot}`;
    const res = await http.get<{ content: string }>(
      `/api/files/read?path=${encodeURIComponent(snapDir)}`,
    );
    return res.ok ? (res.data?.content ?? null) : null;
  },

  /** 从快照恢复文档 */
  restoreSnapshot: async (
    title: string,
    snapshot: string,
  ): Promise<boolean> => {
    const res = await http.post<{ restored: boolean }>(
      "/v1/knowledge/restore",
      { title, snapshot },
    );
    return res.ok ? (res.data?.restored ?? false) : false;
  },

  /** 获取知识库健康指标 */
  health: async (): Promise<{
    totalDocs: number;
    totalIssues: number;
    brokenLinks: number;
    expiredDocs: number;
    orphanDocs: number;
    structureErrors: number;
    consistencyWarnings: number;
    qualityIssues: number;
    lintScore: number;
  }> => {
    const res = await http.get<{
      totalDocs: number;
      totalIssues: number;
      brokenLinks: number;
      expiredDocs: number;
      orphanDocs: number;
      structureErrors: number;
      consistencyWarnings: number;
      qualityIssues: number;
    }>("/v1/knowledge/health");
    const data = unwrap(res, "KNOWLEDGE_HEALTH");
    return { ...data, lintScore: 0 };
  },

  /** 软删除文档（移至回收站） */
  trash: async (docPath: string): Promise<boolean> => {
    const res = await http.post<unknown>("/v1/knowledge/trash", { docPath });
    if (res.ok) return true;
    handleClientError(new Error(res.error?.message ?? "trash failed"), {
      module: "services:knowledge",
      action: "trash",
    });
    return false;
  },

  /** 从回收站恢复文档 */
  restoreTrash: async (docPath: string): Promise<boolean> => {
    const res = await http.post<unknown>("/v1/knowledge/restore-trash", {
      docPath,
    });
    if (res.ok) return true;
    handleClientError(new Error(res.error?.message ?? "restoreTrash failed"), {
      module: "services:knowledge",
      action: "restoreTrash",
    });
    return false;
  },

  /** W11: 获取语义索引状态 */
  getSemanticIndex: async (): Promise<Record<string, unknown>> => {
    const res = await http.get<Record<string, unknown>>(
      "/v1/knowledge/semantic-index",
    );
    return unwrap(res, "KNOWLEDGE_SEMANTIC_INDEX");
  },
};
