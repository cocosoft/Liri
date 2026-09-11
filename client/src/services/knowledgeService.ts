import type {
  KnowledgeItem,
  KnowledgeSearchResult,
  KnowledgeSearchHit,
  BucketedKnowledgeSearch,
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

/** P3-2: 统一"按知识库拉取文件列表"逻辑（listFiles 与 getFileByDocPath 共用） */
async function fetchFiles(
  base?: string,
  offset?: number,
  limit?: number,
  includeContent?: boolean,
  sortBy?: string,
  docPath?: string,
  category?: string,
  source?: string,
): Promise<{
  items: KnowledgeFile[];
  total: number;
  /** P2#9：base 级分类/来源全量清单（跨页） */
  categoryNames?: string[];
  sourceNames?: string[];
}> {
  const params = new URLSearchParams();
  if (base) params.set("base", base);
  if (offset !== undefined) params.set("offset", String(offset));
  if (limit !== undefined) params.set("limit", String(limit));
  // KB-P1-7.5：列表优化——includeContent=false 时后端裁剪 content 字段
  if (includeContent === false) params.set("includeContent", "false");
  // KB-C6：排序下移服务端（updated/title/created）
  if (sortBy) params.set("sortBy", sortBy);
  // KB-L2：docPath 精确过滤（getFileByDocPath 单文档查询，避免全量拉取）
  if (docPath) params.set("docPath", docPath);
  // P1：分类/来源过滤下移服务端（跨页命中可达）
  if (category) params.set("category", category);
  if (source) params.set("source", source);
  const qs = params.toString();
  const url = qs ? `/v1/knowledge?${qs}` : "/v1/knowledge";
  const res = await http.get<{
    items: KnowledgeFile[];
    total: number;
    categoryNames?: string[];
    sourceNames?: string[];
  }>(url);
  return unwrap(res, "KNOWLEDGE_LIST_FILES");
}

// ─── knowledgeService ────────────────────────────────────

/** 方案 B v7：编译阶段（与后端 CompileProgressTracker 的 CompilePhase 对齐） */
export type CompilePhase =
  | "scanning"
  | "cleaning"
  | "compiling"
  | "linting"
  | "graph_extract"
  | "record_extract"
  | "rule_extract"
  | "chunk_refresh"
  | "indexing";

export type PhaseStatus =
  "pending" | "running" | "done" | "skipped" | "triggered";

export type PhaseSkipReason =
  "gated" | "busy" | "memory" | "truncated" | "empty" | "aborted";

export interface PhaseSnapshot {
  phase: CompilePhase;
  status: PhaseStatus;
  skipReason: PhaseSkipReason | null;
  startedAt: number | null;
  durationMs: number | null;
  detail: { current: number; total: number } | null;
}

/** 已结束会话摘要（空闲态复盘；与后端 CompileSessionSummary 对齐） */
export interface CompileSessionSummary {
  sessionId: number;
  outcome: "done" | "aborted";
  finishedAt: number;
  durationMs: number;
  result: {
    compiled: number;
    skipped: number;
    errors: number;
    /** 前若干条错误文本（后端已截断为前 5 条） */
    errorSamples?: string[];
  } | null;
  lastError: string | null;
  phases: PhaseSnapshot[];
}

/** 方案 B v7：编译进度（含 9 阶段快照） */
export interface CompileProgressStatus {
  status: "idle" | "compiling" | "done";
  current: number;
  total: number;
  startedAt: number;
  lastError: string | null;
  result: {
    compiled: number;
    skipped: number;
    errors: number;
    /** 前若干条错误文本（后端已截断为前 5 条） */
    errorSamples?: string[];
  } | null;
  /** 会话序号：全局单调，60s 重置不归零（跨会话去重） */
  sessionId: number;
  /** 广播序号：全局单调，60s 重置不归零（同会话内乱序去重） */
  seq: number;
  phase: CompilePhase | null;
  phases: PhaseSnapshot[];
  /** 上一次已结束会话摘要（60s 复位不清除；空闲态用它复盘） */
  lastSession: CompileSessionSummary | null;
}

/** 方案 B v7 §4.4：血缘产物类型（与后端 LineageStore.LineageArtifactType 对齐） */
export type LineageArtifactType = "page" | "record" | "rule" | "node";

/** 方案 B v7 §4.4：血缘条目 */
export interface KnowledgeLineageLink {
  /** 源文档（raw 路径或编译页路径） */
  docPath: string;
  artifactType: LineageArtifactType;
  /** 产物 ID（页面路径 / record.id / rule.id / nodeId） */
  artifactId: string;
  domain: string;
  /** 编译版本（K5.3） */
  version: number;
  createdAt: number;
}

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

  /** R3+B7：分桶搜索（docs + rules/faqs/records/sources，?buckets=1） */
  searchBucketed: (
    query: string,
    base?: string,
  ): Promise<BucketedKnowledgeSearch> => {
    return getOTelTracing().asyncWrap(
      "services:knowledge:searchBucketed",
      async () => {
        const params = new URLSearchParams();
        params.set("buckets", "1");
        if (base) params.set("base", base);
        const res = await http.post<BucketedKnowledgeSearch>(
          `/v1/knowledge/search?${params.toString()}`,
          { query },
        );
        return unwrap(res, "KNOWLEDGE_SEARCH_BUCKETED");
      },
    );
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
        // P2-7: 优先使用后端真实元数据，缺失时回退默认值
        size: r.size ?? 0,
        updated_at: r.updated_at ?? 0,
        created_at: r.created_at ?? 0, // KB-L4：透传后端字段，缺失回退 0（原硬编码 0）
        source: r.source ?? "manual",
        base: base ?? "",
      },
      score: r.score,
      matchType: (r.matchType as KnowledgeSearchHit["matchType"]) ?? "keyword",
      snippet: r.content.slice(0, 200),
      // B10 透出：keyword/语义命中行号（F2 行定位前置）
      startLine: r.startLine,
      endLine: r.endLine,
    }));
  },

  /** 获取增强知识列表（支持按知识库过滤，返回完整文件元数据） */
  listFiles: async (
    base?: string,
    offset?: number,
    limit?: number,
    includeContent?: boolean,
    // KB-C6：排序下移服务端（updated/title/created）
    sortBy?: string,
    // P1：分类/来源过滤下移服务端（跨页命中可达）
    category?: string,
    source?: string,
  ): Promise<{
    items: KnowledgeFile[];
    total: number;
    categoryNames?: string[];
    sourceNames?: string[];
  }> => {
    return fetchFiles(
      base,
      offset,
      limit,
      includeContent,
      sortBy,
      undefined,
      category,
      source,
    );
  },

  /** P3-2: 按 docPath 从列表接口拉取真实文件元数据（搜索结果占位元数据的统一获取通道） */
  getFileByDocPath: async (
    docPath: string,
    base?: string,
  ): Promise<KnowledgeFile | null> => {
    try {
      // KB-L2：后端 docPath 精确过滤（limit=1），不再全量拉取 100000 条再 find
      const { items } = await fetchFiles(base, 0, 1, true, undefined, docPath);
      return items[0] ?? null;
    } catch {
      return null;
    }
  },

  /** KB-DOC（2026-08-27）：按 docPath 获取单文档完整内容（编辑器/详情按需拉全文） */
  getDoc: async (docPath: string): Promise<KnowledgeFile | null> => {
    const params = new URLSearchParams();
    params.set("docPath", docPath);
    const res = await http.get<KnowledgeFile>(
      `/v1/knowledge/doc?${params.toString()}`,
    );
    if (!res.ok) return null;
    return res.data ?? null;
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
      { target: newName },
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
      { target: newName },
    );
    return unwrap(res, "KNOWLEDGE_DUPLICATE_BASE");
  },

  saveFromChat: async (params: {
    base?: string;
    title: string;
    content: string;
    sessionId?: string;
    /** 来源标记：聊天保存（默认）或全局速记（quick-note） */
    source?: "chat-save" | "quick-note";
  }): Promise<{ success: boolean; docPath: string; title: string }> => {
    const res = await http.post<{
      success: boolean;
      docPath: string;
      title: string;
    }>("/v1/knowledge/save-from-chat", params);
    return unwrap(res, "KNOWLEDGE_SAVE_FROM_CHAT");
  },

  /** 获取待编译的 raw 文件列表（目录已被后端过滤；compilable 标记按文件名是否可编译） */
  getRawFiles: async (): Promise<{
    files: Array<{
      fileName: string;
      ext: string;
      size: number;
      modifiedAt: number;
      createdAt: number;
      category: string | null;
      source: string | null;
      compilable: boolean;
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
        compilable: boolean;
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

  /**
   * 触发知识库编译
   * KB-COMPILE-ASYNC（2026-08-28）：后端改为异步启动（202 立即返回），
   * 真实结果需轮询 getCompileStatus()（status=done 后取 result）。
   *
   * D6-5：可指定**目标域**（决定用哪个域的本体约束抽取，以及产物归属哪个域）；
   * 不传时后端回落 `knowledge`（与 D6-3 之前的行为一致）。
   */
  triggerCompile: async (
    force?: boolean,
    files?: string[],
    domain?: string,
  ): Promise<{
    success: boolean;
    started: boolean;
    busy?: boolean;
    message?: string;
  }> => {
    const target = domain?.trim();
    const res = await http.post<{
      success: boolean;
      started: boolean;
      busy?: boolean;
      message?: string;
    }>("/v1/knowledge/compile", {
      force,
      // 指定文档编译：files 非空时后端仅编译这些 raw 文件（按文件名匹配）
      ...(files && files.length > 0 ? { files } : {}),
      // D6-5：目标域（空串不传，交由后端回落默认域）
      ...(target ? { domain: target } : {}),
    });
    return unwrap(res, "KNOWLEDGE_COMPILE");
  },

  /** W9: 获取编译进度（v7：含 9 阶段快照 phases[]，done 后 result 含成功/跳过/错误统计） */
  getCompileStatus: async (): Promise<CompileProgressStatus> => {
    const res = await http.get<CompileProgressStatus>(
      "/v1/knowledge/compile-status",
    );
    return unwrap(res, "KNOWLEDGE_COMPILE_STATUS");
  },

  /**
   * 血缘查询（方案 B v7 §4.4）：GET /v1/knowledge/lineage
   * - `docPath` 正查：某源文档产出了哪些 page/record/rule/node
   * - `artifactType` + `artifactId` 反查：某产物来自哪个源文档
   * - `domain` 过滤：按域收敛（如 knowledge）
   */
  getLineage: async (params: {
    docPath?: string;
    artifactType?: LineageArtifactType;
    artifactId?: string;
    domain?: string;
  }): Promise<{ links: KnowledgeLineageLink[]; count: number }> => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, String(v));
    }
    const res = await http.get<{
      links: KnowledgeLineageLink[];
      count: number;
    }>(`/v1/knowledge/lineage?${qs.toString()}`);
    return unwrap(res, "KNOWLEDGE_LINEAGE");
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

  /** 从快照恢复文档，返回恢复后的内容（失败返回 null） */
  restoreSnapshot: async (
    title: string,
    snapshot: string,
  ): Promise<string | null> => {
    const res = await http.post<{ restored: boolean; content: string | null }>(
      "/v1/knowledge/restore",
      { title, snapshot },
    );
    return res.ok ? (res.data?.content ?? null) : null;
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
    /** D5：扫描件 OCR 开关状态（默认关） */
    ocr?: {
      enabled: boolean;
      envVar: string;
      scanMinCharsPerPage: number;
      note: string;
    };
    // KB-P2-12（2026-08-27）：统计面板聚合字段（原 store.items 全量拉取改为单接口聚合）
    sourceDistribution: { source: string; count: number }[];
    tagDistribution: { tag: string; count: number }[];
    recentItems: { id: string; title: string; updated_at: number }[];
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
      lintScore: number;
      ocr?: {
        enabled: boolean;
        envVar: string;
        scanMinCharsPerPage: number;
        note: string;
      };
      sourceDistribution: { source: string; count: number }[];
      tagDistribution: { tag: string; count: number }[];
      recentItems: { id: string; title: string; updated_at: number }[];
    }>("/v1/knowledge/health");
    const data = unwrap(res, "KNOWLEDGE_HEALTH");
    return data;
  },

  /** D5：读取知识库运行时配置（OCR 开关等） */
  getKnowledgeConfig: async (): Promise<{ ocrEnabled?: boolean }> => {
    const res = await http.get<{ ocrEnabled?: boolean }>(
      "/v1/knowledge/config",
    );
    return unwrap(res, "KNOWLEDGE_GET_CONFIG");
  },

  /** D5：更新知识库运行时配置（OCR 开关） */
  updateKnowledgeConfig: async (partial: {
    ocrEnabled: boolean;
  }): Promise<{ ocrEnabled?: boolean }> => {
    const res = await http.put<{ ocrEnabled?: boolean }>(
      "/v1/knowledge/config",
      partial,
    );
    return unwrap(res, "KNOWLEDGE_UPDATE_CONFIG");
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

  /** P2#18：列出回收站 */
  listTrash: async (): Promise<
    Array<{ docPath: string; fileName: string; trashedAt: number }>
  > => {
    const res = await http.get<{
      items: Array<{ docPath: string; fileName: string; trashedAt: number }>;
    }>("/v1/knowledge/trash");
    const data = unwrap(res, "KNOWLEDGE_LIST_TRASH");
    return data.items ?? [];
  },

  /** P2#18：永久删除回收站条目 */
  purgeTrash: async (docPath: string): Promise<boolean> => {
    const params = new URLSearchParams();
    params.set("docPath", docPath);
    const res = await http.delete<{ purged: boolean }>(
      `/v1/knowledge/trash?${params.toString()}`,
    );
    if (res.ok) return true;
    handleClientError(new Error(res.error?.message ?? "purge failed"), {
      module: "services:knowledge",
      action: "purgeTrash",
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
};
