import type {
  KnowledgeItem,
  KnowledgeSearchResult,
  KnowledgeBase,
  KnowledgeFile,
} from "../types";
import { httpLegacy as http, HTTPClientError } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch (e) {
    handleClientError(e, {
      module: "services:knowledge",
      action: "getTauriCore",
    });
    return null;
  }
}

async function tryTauri<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch (e) {
    handleClientError(e, { module: "services:knowledge", action: "tryTauri" });
    return null;
  }
}

function createMemoryKnowledgeService() {
  const items: KnowledgeItem[] = [];
  return {
    list: async (): Promise<KnowledgeItem[]> => [...items],
    get: async (_id: string): Promise<KnowledgeItem | null> =>
      items.find((i) => i.id === _id) || null,
    create: async (
      item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">,
    ): Promise<KnowledgeItem> => {
      const now = Date.now();
      const newItem: KnowledgeItem = {
        ...item,
        id: `mem-${now}`,
        created_at: now,
        updated_at: now,
      };
      items.push(newItem);
      return newItem;
    },
    update: async (
      id: string,
      updates: Partial<KnowledgeItem>,
    ): Promise<KnowledgeItem> => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) throw new Error(`Knowledge item ${id} not found`);
      items[idx] = { ...items[idx], ...updates, updated_at: Date.now() };
      return items[idx];
    },
    delete: async (_id: string): Promise<void> => {
      const idx = items.findIndex((i) => i.id === _id);
      if (idx !== -1) items.splice(idx, 1);
    },
    search: async (_query: string): Promise<KnowledgeItem[]> => {
      const q = _query.toLowerCase();
      return items.filter(
        (i) =>
          (i.title && i.title.toLowerCase().includes(q)) ||
          (i.content && i.content.toLowerCase().includes(q)),
      );
    },
    hybridSearch: async (_query: string): Promise<KnowledgeSearchResult[]> => {
      const q = _query.toLowerCase();
      const filtered = items.filter(
        (i) =>
          (i.title && i.title.toLowerCase().includes(q)) ||
          (i.content && i.content.toLowerCase().includes(q)),
      );
      return filtered.map((i) => ({
        id: i.id,
        title: i.title,
        content: i.content,
        category: "根目录",
        score: 1.0,
        matchType: "keyword",
        docPath: i.id,
      }));
    },
  };
}

export const knowledgeService = {
  list: (): Promise<KnowledgeItem[]> => {
    return getOTelTracing().asyncWrap("services:knowledge:list", async () => {
      try {
        const data = await http.get<{ items: KnowledgeItem[]; total: number }>(
          "/v1/knowledge",
        );
        return Array.isArray(data) ? data : data.items || [];
      } catch (e) {
        handleClientError(e, { module: "services:knowledge", action: "list" });
        const result = await tryTauri<KnowledgeItem[]>("list_knowledge");
        if (result) return result;
        return createMemoryKnowledgeService().list();
      }
    });
  },

  get: async (id: string): Promise<KnowledgeItem | null> => {
    try {
      return await http.get<KnowledgeItem | null>(`/v1/knowledge/${id}`);
    } catch (e) {
      handleClientError(e, { module: "services:knowledge", action: "get" });
      const result = await tryTauri<KnowledgeItem | null>("get_knowledge", {
        id,
      });
      if (result !== null) return result;
      return createMemoryKnowledgeService().get(id);
    }
  },

  create: async (
    item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">,
  ): Promise<KnowledgeItem> => {
    try {
      return await http.post<KnowledgeItem>("/v1/knowledge", item);
    } catch (e) {
      handleClientError(e, { module: "services:knowledge", action: "create" });
      const result = await tryTauri<KnowledgeItem>("create_knowledge", {
        item,
      });
      if (result) return result;
      return createMemoryKnowledgeService().create(item);
    }
  },

  update: async (
    id: string,
    updates: Partial<KnowledgeItem>,
  ): Promise<KnowledgeItem> => {
    try {
      return await http.put<KnowledgeItem>(`/v1/knowledge/${id}`, updates);
    } catch (e) {
      handleClientError(e, { module: "services:knowledge", action: "update" });
      const result = await tryTauri<KnowledgeItem>("update_knowledge", {
        id,
        updates,
      });
      if (result) return result;
      return createMemoryKnowledgeService().update(id, updates);
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      await http.delete<void>(`/v1/knowledge/${id}`);
    } catch (e) {
      handleClientError(e, { module: "services:knowledge", action: "delete" });
      const result = await tryTauri<void>("delete_knowledge", { id });
      if (result !== null) return;
      return createMemoryKnowledgeService().delete(id);
    }
  },

  search: (query: string): Promise<KnowledgeItem[]> => {
    return getOTelTracing().asyncWrap("services:knowledge:search", async () => {
      try {
        return await http.post<KnowledgeItem[]>("/v1/knowledge/search", {
          query,
        });
      } catch (e) {
        handleClientError(e, {
          module: "services:knowledge",
          action: "search",
        });
        const result = await tryTauri<KnowledgeItem[]>("search_knowledge", {
          query,
        });
        if (result) return result;
        return createMemoryKnowledgeService().search(query);
      }
    });
  },

  hybridSearch: async (
    query: string,
    base?: string,
    domain?: string,
  ): Promise<KnowledgeSearchResult[]> => {
    try {
      const params = new URLSearchParams();
      if (base) params.set("base", base);
      if (domain) params.set("domain", domain);
      const qs = params.toString();
      const url = qs ? `/v1/knowledge/search?${qs}` : "/v1/knowledge/search";
      return await http.post<KnowledgeSearchResult[]>(url, { query });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "hybridSearch",
      });
      const result = await tryTauri<KnowledgeSearchResult[]>(
        "search_knowledge",
        { query },
      );
      if (result) return result;
      return createMemoryKnowledgeService().hybridSearch(query);
    }
  },

  /**
   * 获取增强知识列表（支持按知识库过滤，返回完整文件元数据）
   */
  listFiles: async (
    base?: string,
    offset?: number,
    limit?: number,
  ): Promise<{ items: KnowledgeFile[]; total: number }> => {
    try {
      const params = new URLSearchParams();
      if (base) params.set("base", base);
      if (offset !== undefined) params.set("offset", String(offset));
      if (limit !== undefined) params.set("limit", String(limit));
      const qs = params.toString();
      const url = qs ? `/v1/knowledge?${qs}` : "/v1/knowledge";
      const data = await http.get<{ items: KnowledgeFile[]; total: number }>(
        url,
      );
      return data;
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "listFiles",
      });
      const result = await tryTauri<KnowledgeFile[]>(
        "list_knowledge",
        base ? { base } : {},
      );
      if (result) return { items: result, total: result.length };
      const mem =
        createMemoryKnowledgeService().list() as unknown as KnowledgeFile[];
      return { items: mem, total: mem.length };
    }
  },

  listBases: async (): Promise<KnowledgeBase[]> => {
    try {
      return await http.get<KnowledgeBase[]>("/v1/knowledge/bases");
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "listBases",
      });
      const result = await tryTauri<KnowledgeBase[]>("list_knowledge_bases");
      if (result) return result;
      return [];
    }
  },

  createBase: async (
    name: string,
    label: string,
    icon?: string,
  ): Promise<KnowledgeBase> => {
    try {
      return await http.post<KnowledgeBase>("/v1/knowledge/bases", {
        name,
        label,
        icon,
      });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "createBase",
      });
      const result = await tryTauri<KnowledgeBase>("create_knowledge_base", {
        name,
        label,
        icon,
      });
      if (result) return result;
      throw new Error("createBase failed");
    }
  },

  updateBase: async (
    name: string,
    updates: Partial<KnowledgeBase>,
  ): Promise<KnowledgeBase> => {
    try {
      return await http.put<KnowledgeBase>(
        `/v1/knowledge/bases/${encodeURIComponent(name)}`,
        updates,
      );
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "updateBase",
      });
      const result = await tryTauri<KnowledgeBase>("update_knowledge_base", {
        name,
        updates,
      });
      if (result) return result;
      throw new Error("updateBase failed");
    }
  },

  deleteBase: async (name: string): Promise<void> => {
    try {
      await http.delete<void>(
        `/v1/knowledge/bases/${encodeURIComponent(name)}`,
      );
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "deleteBase",
      });
      const result = await tryTauri<void>("delete_knowledge_base", { name });
      if (result !== undefined) return;
      throw new Error("deleteBase failed");
    }
  },

  saveFromChat: async (params: {
    base?: string;
    title: string;
    content: string;
    sessionId?: string;
  }): Promise<{ success: boolean; docPath: string; title: string }> => {
    try {
      return await http.post("/v1/knowledge/save-from-chat", params);
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "saveFromChat",
      });
      const result = await tryTauri("save_from_chat", params);
      if (result) return result as any;
      throw new Error("saveFromChat failed");
    }
  },

  /**
   * 获取待编译的 raw 文件列表
   */
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
    try {
      return await http.get("/v1/knowledge/raw-files");
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "getRawFiles",
      });
      const result = await tryTauri("knowledge_raw_files", {});
      if (result) return result as any;
      return { files: [], totalCount: 0 };
    }
  },

  /**
   * 更新知识库文档内容（保留 frontmatter 元数据）
   * @param docPath 文档路径（相对于知识库根目录）
   * @param content 新的 Markdown 内容
   * @param title 可选的新标题
   */
  updateDoc: async (
    docPath: string,
    content: string,
    title?: string,
    extra?: { tags?: string[]; category?: string; base?: string },
  ): Promise<{ docPath: string; updatedAt: string }> => {
    const body: any = { docPath, content };
    if (title !== undefined) body.title = title;
    if (extra?.tags !== undefined) body.tags = extra.tags;
    if (extra?.category !== undefined) body.category = extra.category;
    if (extra?.base !== undefined) body.base = extra.base;
    try {
      return await http.put("/v1/knowledge/docs", body);
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "updateDoc",
      });
      const result = await tryTauri("knowledge_update_doc", body);
      if (result) return result as any;
      throw new Error("updateDoc failed");
    }
  },

  /**
   * 上传文件到指定知识库
   * @param baseName 目标知识库名称
   * @param file 文件信息：name（文件名）、data（base64 编码的内容）
   * @param tags 可选标签列表
   */
  uploadToBase: (
    baseName: string,
    file: { name: string; data: string },
    tags?: string[],
  ): Promise<{ docPath: string; title: string; size: number }> => {
    return getOTelTracing().asyncWrap("services:knowledge:upload", async () => {
      try {
        return await http.post("/v1/knowledge/upload", {
          baseName,
          ...file,
          tags,
        });
      } catch (err) {
        handleClientError(err, {
          module: "services:knowledge",
          action: "uploadToBase",
        });
        if (err instanceof HTTPClientError) {
          throw err;
        }
        const result = await tryTauri("knowledge_upload", {
          baseName,
          file,
          tags,
        });
        if (result) return result as any;
        throw new Error("uploadToBase failed");
      }
    });
  },

  /**
   * 触发知识库编译：将 raw/ 目录中的原始文件通过 LLM 编译为结构化文档
   * @param force 是否强制重编译已编译的文件
   */
  triggerCompile: async (
    force?: boolean,
  ): Promise<{ compiled: number; skipped: number; errors: string[] }> => {
    try {
      return await http.post("/v1/knowledge/compile", { force });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "triggerCompile",
      });
      const result = await tryTauri("knowledge_compile", { force });
      if (result) return result as any;
      throw new Error("triggerCompile failed");
    }
  },

  /**
   * W9: 获取编译进度
   */
  getCompileStatus: async (): Promise<{
    status: "idle" | "compiling" | "done";
    current: number;
    total: number;
    startedAt: number;
    lastError: string | null;
  }> => {
    return http.get("/v1/knowledge/compile-status");
  },

  /**
   * 将知识文档导出到 Notebook 兼容格式
   * @param docPath 文档路径（相对于知识库根目录）
   * @param title 可选标题
   */
  exportToNotebook: async (
    docPath: string,
    title?: string,
  ): Promise<{ exportPath: string; fileName: string; size: number }> => {
    try {
      return await http.post("/v1/knowledge/export-to-notebook", {
        docPath,
        title,
      });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "exportToNotebook",
      });
      const result = await tryTauri("knowledge_export_notebook", {
        docPath,
        title,
      });
      if (result) return result as any;
      throw new Error("exportToNotebook failed");
    }
  },

  /**
   * 从外部文件导入知识文档
   * @param filePath 源文件路径
   * @param baseName 目标知识库名称
   * @param tags 可选标签列表
   */
  importFromFile: async (
    filePath: string,
    baseName?: string,
    tags?: string[],
  ): Promise<{ docPath: string; title: string; size: number }> => {
    try {
      return await http.post("/v1/knowledge/import-from-file", {
        filePath,
        baseName,
        tags,
      });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "importFromFile",
      });
      const result = await tryTauri("knowledge_import_file", {
        filePath,
        baseName,
        tags,
      });
      if (result) return result as any;
      throw new Error("importFromFile failed");
    }
  },

  /**
   * 批量删除知识文档
   * @param ids 文档ID（docPath）数组
   */
  batchDelete: async (ids: string[]): Promise<{ deleted: number }> => {
    try {
      return await http.post("/v1/knowledge/batch-delete", { ids });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "batchDelete",
      });
      const result = await tryTauri("knowledge_batch_delete", { ids });
      if (result) return result as any;
      throw new Error("batchDelete failed");
    }
  },

  /**
   * 批量添加标签到知识文档
   * @param ids 文档ID（docPath）数组
   * @param tags 要添加的标签列表
   */
  batchTag: async (
    ids: string[],
    tags: string[],
  ): Promise<{ updated: number }> => {
    try {
      return await http.post("/v1/knowledge/batch-tag", { ids, tags });
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "batchTag",
      });
      const result = await tryTauri("knowledge_batch_tag", { ids, tags });
      if (result) return result as any;
      throw new Error("batchTag failed");
    }
  },

  /**
   * 列出文档的快照版本
   */
  listSnapshots: async (title: string): Promise<string[]> => {
    try {
      const data = await http.get<{ snapshots: string[] }>(
        `/v1/knowledge/snapshots?title=${encodeURIComponent(title)}`,
      );
      return data.snapshots;
    } catch (err) {
      handleClientError(err, {
        module: "services:knowledge",
        action: "listSnapshots",
      });
      if (err instanceof HTTPClientError && err.status === 400) return [];
      throw err;
    }
  },

  /**
   * W6: 获取快照内容（替换直接 fetch）
   */
  getSnapshotContent: async (
    title: string,
    snapshot: string,
  ): Promise<string | null> => {
    try {
      const snapDir = `.knowledge-snapshots/${title}/${snapshot}`;
      const resp = await http.get<{ content: string }>(
        `/api/files/read?path=${encodeURIComponent(snapDir)}`,
      );
      return resp.content || null;
    } catch (err) {
      handleClientError(err, {
        module: "services:knowledge",
        action: "getSnapshotContent",
      });
      return null;
    }
  },

  /**
   * 从快照恢复文档
   */
  restoreSnapshot: async (
    title: string,
    snapshot: string,
  ): Promise<boolean> => {
    try {
      const data = await http.post<{ restored: boolean }>(
        "/v1/knowledge/restore",
        { title, snapshot },
      );
      return data.restored;
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "restoreSnapshot",
      });
      return false;
    }
  },

  /**
   * 获取知识库健康指标
   */
  health: async (): Promise<{
    totalDocs: number;
    totalIssues: number;
    brokenLinks: number;
    expiredDocs: number;
    orphanDocs: number;
    structureErrors: number;
    consistencyWarnings: number;
    qualityIssues: number;
  }> => {
    return http.get("/v1/knowledge/health");
  },

  /**
   * 软删除文档（移至回收站）
   */
  trash: async (docPath: string): Promise<boolean> => {
    try {
      await http.post("/v1/knowledge/trash", { docPath });
      return true;
    } catch (e) {
      handleClientError(e, { module: "services:knowledge", action: "trash" });
      return false;
    }
  },

  /**
   * 从回收站恢复文档
   */
  restoreTrash: async (docPath: string): Promise<boolean> => {
    try {
      await http.post("/v1/knowledge/restore-trash", { docPath });
      return true;
    } catch (e) {
      handleClientError(e, {
        module: "services:knowledge",
        action: "restoreTrash",
      });
      return false;
    }
  },

  /**
   * W11: 获取语义索引状态（替换直接 fetch）
   */
  getSemanticIndex: async (): Promise<Record<string, unknown>> => {
    return http.get("/v1/knowledge/semantic-index");
  },
};
