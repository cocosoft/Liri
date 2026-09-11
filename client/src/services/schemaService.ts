import type {
  OntologyBackupList,
  OntologyDiffResult,
  OntologyDomainList,
  OntologyRestoreResult,
  OntologySchemaFile,
  OntologySchemaInfo,
  OntologyValidationResult,
  OntologyWriteResult,
} from "../types/project";
import { http } from "./httpClient";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

/**
 * O17：把域拼成查询串（缺省不带 query → 服务端走全局目录，与改造前一致）
 *
 * 服务端语义：**域优先，域未声明本体时回落全局** —— 读/写/校验/备份/恢复共用同一解析，
 * 因此前端只要把"当前选中的域"原样带上，就不会出现"看 A 改 B"。
 */
function domainQuery(domain?: string): string {
  return domain && domain.trim()
    ? `?domain=${encodeURIComponent(domain.trim())}`
    : "";
}

/** 待校验内容：原始 YAML 模式传 files，表单模式传 models（两者共用服务端同一校验器） */
export interface OntologyDraft {
  files?: Partial<
    Record<"entities.yaml" | "edges.yaml" | "xref.yaml", string>
  >;
  models?: Partial<
    Record<OntologySchemaFile, Array<Record<string, unknown>>>
  >;
}

/**
 * 知识本体（.schema）服务
 *
 * 后端契约：
 * - `GET  /v1/knowledge/schema`          → 模式 / 来源目录 / 白名单 / 表单模型（只读，**不触发** ensureDefaults）
 * - `POST /v1/knowledge/schema/validate` → 逐项校验（恒 200 + ok 标记；可校验待保存草稿）
 * - `PUT  /v1/knowledge/schema/{file}`   → 写入单个文件（服务端强制校验 → 不过则 400 且不写盘；写前备份 + 原子写）
 *
 * YAML 的解析与序列化**只在服务端**：前端表单提交结构化 model，由后端 dump 成 YAML。
 */
export const schemaService = {
  /** 读取当前模式 / 来源目录 / 白名单 / 表单模型（可按域，D6-3） */
  getSchema: async (domain?: string): Promise<OntologySchemaInfo> => {
    const res = await http.get<OntologySchemaInfo>(
      `/v1/knowledge/schema${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`,
    );
    return unwrap(res, "SCHEMA_GET");
  },

  /** D6-3：知识域清单（默认域始终在列表内） */
  listDomains: async (): Promise<OntologyDomainList> => {
    const res = await http.get<OntologyDomainList>("/v1/knowledge/domains");
    return unwrap(res, "SCHEMA_DOMAINS");
  },

  /**
   * 逐项校验
   * @param draft 省略 = 校验磁盘现状；传入 = 校验待保存草稿（scope=draft）
   */
  validate: async (
    draft?: OntologyDraft,
    domain?: string,
  ): Promise<OntologyValidationResult> => {
    const res = await http.post<OntologyValidationResult>(
      `/v1/knowledge/schema/validate${domainQuery(domain)}`,
      draft ?? {},
    );
    return unwrap(res, "SCHEMA_VALIDATE");
  },

  /** 写入单个本体文件（表单模式传 model，原始 YAML 模式传 content） */
  putFile: async (
    file: OntologySchemaFile,
    payload: { content: string } | { model: Array<Record<string, unknown>> },
    domain?: string,
  ): Promise<OntologyWriteResult> => {
    const res = await http.put<OntologyWriteResult>(
      `/v1/knowledge/schema/${file}${domainQuery(domain)}`,
      payload,
    );
    return unwrap(res, "SCHEMA_PUT");
  },

  /**
   * 预览"磁盘现状 → 待保存草稿"的 unified diff（只读，不写盘）
   *
   * diff 由服务端用 `computeUnifiedDiff` 生成（与文件写入工具同一实现）。
   */
  diff: async (
    draft: OntologyDraft,
    domain?: string,
  ): Promise<OntologyDiffResult> => {
    const res = await http.post<OntologyDiffResult>(
      `/v1/knowledge/schema/diff${domainQuery(domain)}`,
      draft,
    );
    return unwrap(res, "SCHEMA_DIFF");
  },

  /** 历史备份列表（新 → 旧；只读，按域） */
  listBackups: async (domain?: string): Promise<OntologyBackupList> => {
    const res = await http.get<OntologyBackupList>(
      `/v1/knowledge/schema/backup${domainQuery(domain)}`,
    );
    return unwrap(res, "SCHEMA_BACKUP_LIST");
  },

  /** 用指定备份覆盖某个文件（服务端先校验、并先备份当前状态 → 可回滚；按域） */
  restoreBackup: async (
    backupId: string,
    file: OntologySchemaFile,
    domain?: string,
  ): Promise<OntologyRestoreResult> => {
    const res = await http.post<OntologyRestoreResult>(
      `/v1/knowledge/schema/backup/${encodeURIComponent(backupId)}/restore${domainQuery(domain)}`,
      { file },
    );
    return unwrap(res, "SCHEMA_BACKUP_RESTORE");
  },
};
