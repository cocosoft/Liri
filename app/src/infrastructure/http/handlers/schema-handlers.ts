// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * schema-handlers.ts — 知识本体（.schema）只读 HTTP 处理器 + 显式 scaffold
 *
 * 端点：
 *   GET  /v1/knowledge/schema          → 当前模式 / 来源目录 / 白名单（只读）
 *   POST /v1/knowledge/schema/validate → 逐项校验（只读，含"运行时静默忽略项"）
 *   POST /v1/knowledge/schema/scaffold → 显式生成默认 schema（**写盘，需 confirm:true**）
 *
 * ⚠️ 只读契约：前两个端点**不得**触发 `SchemaLoader.ensureDefaults()`（那会在目录不存在时
 * 创建并写入默认 3 份 YAML：entities/edges/xref，把用户从 freeform 静默切到 constrained）。
 * 因此它们只调用 `loadEntities/loadEdges/loadXref`（各自 `existsSync` 前置，缺文件返回空），
 * **绝不调用 `loadAll()`**。唯一的写盘入口是 scaffold，且必须显式 `{"confirm": true}`。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import type http from 'http';
import { readRequestBody, sendError, sendErrorMapped } from './handler-utils';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  readSchemaRawDoc,
  type SchemaLoader,
} from '@modules/knowledge/schema/SchemaLoader';
import type { FormSchemaFile } from '@modules/knowledge/schema/schemaFormModel';

const logger = getLogger('infra:handler:schema');

/** D1/B2a：允许写入的本体文件（B2c 起含 xref.yaml） */
const WRITABLE_SCHEMA_FILES = [
  'entities.yaml',
  'edges.yaml',
  'xref.yaml',
] as const;

/** 支持「表单模式（结构化模型）」的文件 —— xref 结构不同，只走原始 YAML 模式 */
const FORM_MODEL_FILES = ['entities.yaml', 'edges.yaml'] as const;

/** 备份目录名合法性（时间戳形如 `2026-09-11T09-28-40-093Z`）——**防路径穿越** */
const BACKUP_ID_RE = /^[0-9A-Za-z-]+$/;

/** 备份保留份数 */
const SCHEMA_BACKUP_KEEP = 10;

/** diff 规模上限（`computeUnifiedDiff` 为 O(n·m)，防止超大文件把服务端拖死） */
const MAX_DIFF_CELLS = 250_000;

/** 读取本体文件原始文本（缺失 → null；**坏文件也返回文本**，便于在原始模式下修复） */
function rawTextOf(schemaDir: string, file: string): string | null {
  const raw = readSchemaRawDoc(schemaDir, file);
  return raw.status === 'missing' ? null : raw.text;
}

/**
 * 默认域：其本体**就是全局 `.schema/`**（D6-4 迁移语义 —— 不复制文件、不新建
 * `domains/knowledge/.schema/`，全局目录即该域的本体目录）
 */
const DEFAULT_DOMAIN = 'knowledge';

/** 本体文件名 */
type SchemaFileName = 'entities.yaml' | 'edges.yaml' | 'xref.yaml';

const SCHEMA_FILE_NAMES: SchemaFileName[] = [
  'entities.yaml',
  'edges.yaml',
  'xref.yaml',
];

/**
 * 本体解析计划（D6-4：**读逐文件兜底、写按域隔离**）
 *
 * - **读**：每个文件**独立**判定 —— 域目录有该文件就用域，否则用全局
 *   （与 `SchemaLoader.loadGraphSchemas()` 的"域→全局逐文件兜底"**完全一致**，
 *   消除"域里显示未声明、编译却用全局"的"看 A 用 B"）；
 * - **写**（PUT / 备份 / 恢复）：默认域 `knowledge` 或未传域 → **全局目录**（迁移语义）；
 *   非默认域 → **该域目录**（缺失文件即"为该域新建"，不反向污染全局基线）。
 */
interface SchemaPlan {
  /** 请求中的域（未传为 null） */
  domain: string | null;
  /** 生效域（默认域/未传域为 undefined，表示"直接用全局"） */
  effectiveDomain: string | undefined;
  /** 全局目录 */
  globalDir: string;
  /** 该域目录（默认域时等于全局目录） */
  domainDir: string;
  /** 写入目标目录（PUT / 备份 / 恢复） */
  writeDir: string;
  /** 逐文件读取来源目录（GET / validate / diff 基线） */
  fileDirs: Record<SchemaFileName, string>;
  /** 是否存在"文件继承自全局"（逐文件判定） */
  domainFallback: boolean;
}

/** 解析本体操作计划（D6-4；不传域或默认域 = 全局，零行为变更） */
async function resolveSchemaPlan(domain?: string): Promise<SchemaPlan> {
  const { SchemaLoader: Loader } =
    await import('@modules/knowledge/schema/SchemaLoader');

  const globalDir = new Loader().getSchemaDir();
  const normalized = domain?.trim() || undefined;

  if (!normalized || normalized === DEFAULT_DOMAIN) {
    const fileDirs = Object.fromEntries(
      SCHEMA_FILE_NAMES.map((file) => [file, globalDir])
    ) as Record<SchemaFileName, string>;
    return {
      domain: normalized ?? null,
      effectiveDomain: undefined,
      globalDir,
      domainDir: globalDir,
      writeDir: globalDir,
      fileDirs,
      domainFallback: false,
    };
  }

  const domainDir = new Loader(undefined, normalized).getSchemaDir();
  const fileDirs = Object.fromEntries(
    SCHEMA_FILE_NAMES.map((file) => [
      file,
      existsSync(join(domainDir, file)) ? domainDir : globalDir,
    ])
  ) as Record<SchemaFileName, string>;

  return {
    domain: normalized,
    effectiveDomain: normalized,
    globalDir,
    domainDir,
    writeDir: domainDir,
    fileDirs,
    domainFallback: SCHEMA_FILE_NAMES.some(
      (file) => fileDirs[file] === globalDir
    ),
  };
}

/** 从请求 URL 读取 `?domain=`（O17；空白视为未传） */
function domainOf(req: http.IncomingMessage): string | undefined {
  return (
    new URL(req.url ?? '', 'http://localhost').searchParams
      .get('domain')
      ?.trim() || undefined
  );
}

/** 待校验/待预览的草稿内容（文件名 → YAML 文本） */
type DraftOverrides = Partial<
  Record<'entities.yaml' | 'edges.yaml' | 'xref.yaml', string>
>;

/**
 * 解析草稿请求体 —— 支持两种等价形态（B2a/B2b 共用，避免两处各写一份）：
 * - `{ files: { "entities.yaml": "<YAML 文本>" } }`：原始 YAML 模式
 * - `{ models: { "entities.yaml": [...] } }`：表单模式，服务端先 dump 成 YAML
 */
async function resolveDraftOverrides(raw: string): Promise<DraftOverrides> {
  const overrides: DraftOverrides = {};
  if (!raw.trim()) return overrides;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const body = parsed as Record<string, unknown>;
      const files = body.files;
      if (files && typeof files === 'object' && !Array.isArray(files)) {
        Object.assign(overrides, files as DraftOverrides);
      }
      const models = body.models;
      if (models && typeof models === 'object' && !Array.isArray(models)) {
        const { fromFormModel } =
          await import('@modules/knowledge/schema/schemaFormModel');
        for (const [name, rows] of Object.entries(
          models as Record<string, unknown>
        )) {
          if (name === 'entities.yaml' || name === 'edges.yaml') {
            overrides[name] = fromFormModel(name, rows);
          }
        }
      }
    }
  } catch (err) {
    // @ignore-catch 请求体非法 JSON → 按"校验磁盘现状"处理（保持旧行为）；
    // 但模型形状错误（AppError）必须抛出，否则会把"前端传错结构"静默当通过
    if (err instanceof AppError) throw err;
  }
  return overrides;
}

/**
 * 写前备份旧文件到 `<schemaDir>/.backup/<时间戳>/`，并只保留最近 10 份
 * @returns 备份文件路径；原文件不存在时返回 null
 */
function backupExistingFile(schemaDir: string, file: string): string | null {
  const target = join(schemaDir, file);
  if (!existsSync(target)) return null;

  const backupRoot = join(schemaDir, '.backup');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(backupRoot, stamp);
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, file);
  copyFileSync(target, backupPath);

  const staleDirs = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(SCHEMA_BACKUP_KEEP);
  for (const stale of staleDirs) {
    rmSync(join(backupRoot, stale), { recursive: true, force: true });
  }
  return backupPath;
}

/** 备份根目录 */
function backupRootOf(schemaDir: string): string {
  return join(schemaDir, '.backup');
}

/** 备份目录名（时间戳）→ ISO 时间；无法解析返回 null */
function backupIdToIso(id: string): string | null {
  const matched = id.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/
  );
  if (!matched) return null;
  const iso = `${matched[1]}T${matched[2]}:${matched[3]}:${matched[4]}.${matched[5]}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : iso;
}

/** 单个备份的元信息 */
interface SchemaBackupEntry {
  /** 备份标识 = 目录名（时间戳），恢复时原样回传 */
  id: string;
  /** ISO 时间；目录名不符合时间戳格式时为 null */
  createdAt: string | null;
  files: Array<{ name: string; size: number }>;
}

/** 列出备份（新 → 旧），最多 `SCHEMA_BACKUP_KEEP` 份（与清理策略一致） */
function listSchemaBackups(schemaDir: string): SchemaBackupEntry[] {
  const root = backupRootOf(schemaDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BACKUP_ID_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, SCHEMA_BACKUP_KEEP)
    .map((id) => {
      const dir = join(root, id);
      let files: Array<{ name: string; size: number }> = [];
      try {
        files = readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
          .map((entry) => ({
            name: entry.name,
            size: statSync(join(dir, entry.name)).size,
          }));
      } catch {
        // @ignore-catch 目录读取失败（竞态删除）→ 该备份按空列表返回，不影响其他项
      }
      return { id, createdAt: backupIdToIso(id), files };
    });
}

/** GET /v1/knowledge/schema */
export async function handleGetKnowledgeSchema(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { SchemaLoader: Loader } =
      await import('@modules/knowledge/schema/SchemaLoader');
    // D6-4：读**逐文件**兜底（域目录有该文件用域，否则用全局）；写按域隔离
    const plan = await resolveSchemaPlan(domainOf(req));
    const domainLoader: SchemaLoader = new Loader(
      undefined,
      plan.effectiveDomain
    );
    const globalLoader: SchemaLoader = new Loader();
    const loaderFor = (file: SchemaFileName): SchemaLoader =>
      plan.fileDirs[file] === plan.globalDir ? globalLoader : domainLoader;

    const [entities, edges, xref] = await Promise.all([
      loaderFor('entities.yaml').loadEntities(),
      loaderFor('edges.yaml').loadEdges(),
      loaderFor('xref.yaml').loadXref(),
    ]);

    // 存在性也按**逐文件来源**判定（与 mode / 表单可表达性同源）
    const files = {
      entities: existsSync(
        join(plan.fileDirs['entities.yaml'], 'entities.yaml')
      ),
      edges: existsSync(join(plan.fileDirs['edges.yaml'], 'edges.yaml')),
      xref: existsSync(join(plan.fileDirs['xref.yaml'], 'xref.yaml')),
    };
    // 与 KnowledgeCompiler 的 hasGraphSchema 判定保持一致（entities || edges）
    const mode = files.entities || files.edges ? 'constrained' : 'freeform';

    // D1/B2a：表单模式的结构化模型（含"可识别才映射"判定；不可表达时前端禁用表单切换）
    const { formSupportFor } =
      await import('@modules/knowledge/schema/schemaFormModel');
    const form = {
      entities: formSupportFor(plan.fileDirs['entities.yaml'], 'entities.yaml'),
      edges: formSupportFor(plan.fileDirs['edges.yaml'], 'edges.yaml'),
    };
    // D1/B2b：各文件原始 YAML 文本（原始 YAML 模式编辑用；缺失 → null）
    const raw = {
      'entities.yaml': rawTextOf(
        plan.fileDirs['entities.yaml'],
        'entities.yaml'
      ),
      'edges.yaml': rawTextOf(plan.fileDirs['edges.yaml'], 'edges.yaml'),
      'xref.yaml': rawTextOf(plan.fileDirs['xref.yaml'], 'xref.yaml'),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        mode,
        /** D6-3：本次查询的域（未传为 null） */
        domain: plan.domain,
        /** D6-4：是否存在"文件继承自全局"（**逐文件**判定） */
        domainFallback: plan.domainFallback,
        /** 来源目录（= 写入目标目录；默认域即全局 `.schema/`） */
        schemaDir: plan.writeDir,
        /** D6-4：写入目标目录（非默认域 = 该域目录） */
        writeDir: plan.writeDir,
        /** D6-4：逐文件来源目录（供 UI 明示"该文件继承自全局"） */
        fileDirs: plan.fileDirs,
        files,
        form,
        raw,
        counts: {
          entities: entities.size,
          edges: edges.size,
          xref: xref.length,
        },
        // O14：不再返回 `entities[]`（无任何消费方：详情已在 `form.entities.rows` 与 `raw` 中）
        edges: Array.from(edges.values()).map((e) => ({
          type: e.type,
          displayName: e.displayName,
          endpoints: e.endpoints,
          direction: e.direction,
        })),
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'get_schema',
    });
    sendError(res, (err as Error).message, 500);
  }
}

/**
 * POST /v1/knowledge/schema/validate
 *
 * 返回 200 + `{ ok, errors[], warnings[], summary, scope }`：
 * 校验失败属"诊断结果"而非请求失败，固定 200 便于前端直接渲染逐项问题
 * （用 4xx 会被前端 http 封装当异常抛出，反而拿不到明细）。
 *
 * D1/B2：可带 `{ files: { "entities.yaml"?: "<YAML 文本>", "edges.yaml"?: ... } }`
 * → 校验**待保存内容**（其余文件仍取磁盘现状），`scope` 回显 `draft` / `disk`。
 */
export async function handleValidateKnowledgeSchema(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const raw = await readRequestBody(req);
    const overrides = await resolveDraftOverrides(raw);
    const isDraft = Object.keys(overrides).length > 0;

    // D6-4：磁盘现状按**逐文件兜底**读取（与 GET / 编译侧同源）
    const plan = await resolveSchemaPlan(domainOf(req));
    const { SchemaValidator } =
      await import('@modules/knowledge/schema/SchemaValidator');
    const result = new SchemaValidator(
      plan.globalDir,
      overrides,
      plan.fileDirs
    ).validate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...result, scope: isDraft ? 'draft' : 'disk' }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'validate_schema',
    });
    sendErrorMapped(res, err);
  }
}

/**
 * POST /v1/knowledge/schema/diff
 *
 * 预览"磁盘现状 → 待保存草稿"的 unified diff（**只读，不写盘**）。
 * 草稿形态与 validate 一致：`{ files }`（原始 YAML 文本）/ `{ models }`（表单结构化模型）。
 *
 * diff 生成**复用** `computeUnifiedDiff`（与文件写入工具同一实现，不另造算法）；
 * 超大文件直接跳过（该实现为 O(n·m)）→ `skipped: true`；
 * 无差异 → `diff: ''`，前端据此提示"无改动"。
 */
export async function handleDiffKnowledgeSchema(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const raw = await readRequestBody(req);
    const overrides = await resolveDraftOverrides(raw);

    // D6-4：diff 基线 = **当前生效来源**（逐文件兜底，即页面显示的内容）
    const plan = await resolveSchemaPlan(domainOf(req));
    const { computeUnifiedDiff } =
      await import('@modules/chat/utils/unifiedDiff');

    const diffs: Record<
      string,
      { diff: string; additions: number; deletions: number; skipped?: boolean }
    > = {};
    for (const [file, draft] of Object.entries(overrides)) {
      if (typeof draft !== 'string') continue;
      const sourceDir = (SCHEMA_FILE_NAMES as string[]).includes(file)
        ? plan.fileDirs[file as SchemaFileName]
        : plan.globalDir;
      const current = rawTextOf(sourceDir, file) ?? '';
      const cells =
        (current.split('\n').length + 1) * (draft.split('\n').length + 1);
      if (cells > MAX_DIFF_CELLS) {
        diffs[file] = { diff: '', additions: 0, deletions: 0, skipped: true };
        continue;
      }
      diffs[file] = computeUnifiedDiff(current, draft, file);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ diffs }));
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'diff_schema',
    });
    sendErrorMapped(res, err);
  }
}

/**
 * GET /v1/knowledge/schema/backup
 *
 * 列出历史备份（新 → 旧，最多 `SCHEMA_BACKUP_KEEP` 份，与写入时的清理策略一致）。
 * 只读：不创建、不修改、不删除任何文件。
 */
export async function handleListKnowledgeSchemaBackups(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // D6-4：备份列表落在**写入目标目录**（与 PUT 一致）
    const { writeDir: schemaDir } = await resolveSchemaPlan(domainOf(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        schemaDir,
        keep: SCHEMA_BACKUP_KEEP,
        backups: listSchemaBackups(schemaDir),
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'list_schema_backups',
    });
    sendErrorMapped(res, err);
  }
}

/**
 * POST /v1/knowledge/schema/backup/{id}/restore
 *
 * 用指定备份覆盖当前文件（body `{"file": "<name>"}`）。安全约束与普通写入一致，外加三条：
 * 1. `id` 必须匹配时间戳格式 → **防路径穿越**（`../`、绝对路径一律拒绝）
 * 2. 恢复内容**先校验**（备份可能来自手工编辑）→ 不过则 400 且不做任何改动
 * 3. 覆盖前**先备份当前状态** → 恢复动作本身可回滚
 */
export async function handleRestoreKnowledgeSchemaBackup(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  try {
    if (!BACKUP_ID_RE.test(id)) {
      throw new AppError(
        '备份标识非法',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'SCHEMA_INVALID_BACKUP_ID',
        { module: 'infra:handler:schema' }
      );
    }

    const rawBody = await readRequestBody(req);
    let file = '';
    try {
      const parsed: unknown = rawBody.trim() ? JSON.parse(rawBody) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = (parsed as Record<string, unknown>).file;
        if (typeof value === 'string') file = value;
      }
    } catch {
      // @ignore-catch 非法 JSON → 下面按"缺 file"统一报 400
    }
    if (!(WRITABLE_SCHEMA_FILES as readonly string[]).includes(file)) {
      throw new AppError(
        `请求体需为 {"file": "<${WRITABLE_SCHEMA_FILES.join(' | ')}>"}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'SCHEMA_INVALID_BODY',
        { module: 'infra:handler:schema' }
      );
    }

    // D6-4：恢复同样落在**写入目标目录**（与 PUT / 备份一致）
    const plan = await resolveSchemaPlan(domainOf(req));
    const schemaDir = plan.writeDir;
    const sourcePath = join(backupRootOf(schemaDir), id, file);
    if (!existsSync(sourcePath)) {
      throw new AppError(
        `该备份中不存在 ${file}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'SCHEMA_BACKUP_FILE_MISSING',
        { module: 'infra:handler:schema' }
      );
    }
    // 先读入内存：随后的"写前备份"可能触发旧备份清理，不能依赖源文件仍在磁盘上
    const content = readFileSync(sourcePath, 'utf-8');

    const { SchemaValidator } =
      await import('@modules/knowledge/schema/SchemaValidator');
    // D6-4：校验按**逐文件兜底**（本文件用备份内容覆盖），避免"其他文件继承全局"被误判为未声明
    const result = new SchemaValidator(
      plan.writeDir,
      { [file]: content },
      plan.fileDirs
    ).validate();
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: '备份内容未通过校验，未做任何改动',
            type: 'schema_invalid',
          },
          result,
        })
      );
      return;
    }

    mkdirSync(schemaDir, { recursive: true });
    const previous = backupExistingFile(schemaDir, file);
    const target = join(schemaDir, file);
    const tmpPath = `${target}.tmp`;
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, target);

    logger.info('本体文件已从备份恢复（原子写 + 写前备份）', {
      file,
      from: id,
      previous,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        restored: true,
        file,
        from: id,
        /** 恢复前的状态备份路径（如需回退到恢复前，用它再恢复一次） */
        previousBackup: previous,
        effective: result.summary,
        note: '写入只影响下一次编译',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'restore_schema_backup',
    });
    sendErrorMapped(res, err);
  }
}

/**
 * PUT /v1/knowledge/schema/{file}
 *
 * B2a 写入链路（D1=C 的服务端一半）：
 * 1. **服务端强制校验**待保存内容（与校验接口同一份 `SchemaValidator`）→ 不过则 **400 且不写盘**
 * 2. **写前备份**原文件到 `<schemaDir>/.backup/<时间戳>/`（保留最近 10 份）
 * 3. **原子写**：写 `<file>.tmp` → `rename` 覆盖（避免半截文件）
 * 4. **不触发重编译**（只影响下一次编译）；也**不调用 `ensureDefaults`**（不注入默认内容）
 */
export async function handlePutKnowledgeSchemaFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string
): Promise<void> {
  try {
    if (!(WRITABLE_SCHEMA_FILES as readonly string[]).includes(file)) {
      throw new AppError(
        `不支持写入该文件：${file}（当前仅支持 ${WRITABLE_SCHEMA_FILES.join(' / ')}）`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'SCHEMA_FILE_NOT_WRITABLE',
        { module: 'infra:handler:schema' }
      );
    }

    const raw = await readRequestBody(req);
    let content = '';
    let model: unknown;
    try {
      const parsed: unknown = raw.trim() ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const body = parsed as Record<string, unknown>;
        if (typeof body.content === 'string') content = body.content;
        else if (body.model !== undefined) model = body.model;
      }
    } catch {
      // @ignore-catch 非法 JSON → 下面按"缺 content/model"统一报 400
    }
    if (!content.trim() && model === undefined) {
      throw new AppError(
        '请求体需为 {"content": "<YAML 文本>"}（原始 YAML 模式）或 {"model": [...]}（表单模式）',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'SCHEMA_INVALID_BODY',
        { module: 'infra:handler:schema' }
      );
    }

    // 表单模式：结构化模型 → YAML。序列化只在服务端（前端不引入第二套 YAML 实现），
    // 生成后与原始 YAML 模式走**完全相同**的校验 + 备份 + 原子写链路。
    if (!content.trim()) {
      if (!(FORM_MODEL_FILES as readonly string[]).includes(file)) {
        throw new AppError(
          `${file} 不支持表单模式提交（请改用 {"content": "<YAML 文本>"}）`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.LOW,
          'SCHEMA_MODEL_UNSUPPORTED_FILE',
          { module: 'infra:handler:schema' }
        );
      }
      const { fromFormModel } =
        await import('@modules/knowledge/schema/schemaFormModel');
      content = fromFormModel(file as FormSchemaFile, model);
    }

    // D6-4：写入目标 = `plan.writeDir`
    // · 默认域 `knowledge` / 未传域 → 全局 `.schema/`（迁移语义：全局即 knowledge 域的本体）
    // · 非默认域 → **该域目录**（缺失文件即"为该域新建"，不反向污染全局基线）
    // 校验时：本文件用待保存内容覆盖，其余文件按**逐文件兜底**读取（与 GET / 编译侧同源）
    const plan = await resolveSchemaPlan(domainOf(req));
    const { SchemaValidator } =
      await import('@modules/knowledge/schema/SchemaValidator');
    const validator = new SchemaValidator(
      plan.writeDir,
      { [file]: content } as Partial<
        Record<'entities.yaml' | 'edges.yaml', string>
      >,
      plan.fileDirs
    );
    const result = validator.validate();
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: '本体校验未通过，未写入任何文件',
            type: 'schema_invalid',
          },
          result,
        })
      );
      return;
    }

    const schemaDir = validator.getSchemaDir();
    mkdirSync(schemaDir, { recursive: true });
    const target = join(schemaDir, file);
    const backup = backupExistingFile(schemaDir, file);

    const tmpPath = `${target}.tmp`;
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, target);

    logger.info('本体文件已写入（原子写 + 备份）', { file, backup });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        written: true,
        file,
        path: target,
        backup,
        effective: result.summary,
        note: '写入只影响下一次编译',
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'put_schema_file',
    });
    sendErrorMapped(res, err);
  }
}

/**
 * POST /v1/knowledge/schema/scaffold
 *
 * 显式生成默认 schema（唯一写盘入口），两段式：
 * - 未带 `{"confirm": true}` → 只返回预览（当前模式 / 将写入的文件 / 图中现有关系类型数），**不落盘**
 * - `confirm: true` → 调 `loadAll()` 触发 `ensureDefaults()` 写入默认 3 份 YAML（entities/edges/xref），并返回影响面
 *   （新白名单 vs 图中现有 `edge_type` → 被排除的类型与边数）
 *
 * 安全约束：目录内已存在 `entities.yaml` 或 `edges.yaml`（用户已自定义）时**一律不覆盖**。
 */
export async function handleScaffoldKnowledgeSchema(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    let confirm = false;
    if (body.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        // @ignore-catch 请求体格式问题直接用 400 回复，无需进 ErrorTracker
        sendError(
          res,
          '请求体不是合法 JSON（应为 {} 或 {"confirm":true}）',
          400
        );
        return;
      }
      confirm = (parsed as { confirm?: unknown } | null)?.confirm === true;
    }

    const { SchemaLoader: Loader } =
      await import('@modules/knowledge/schema/SchemaLoader');
    const loader: SchemaLoader = new Loader();
    const schemaDir = loader.getSchemaDir();

    const kgModule = await import('@modules/knowledge/graph/KnowledgeGraph');
    const graph = new kgModule.KnowledgeGraph();
    await graph.init();
    try {
      const alreadyExists =
        existsSync(join(schemaDir, 'entities.yaml')) ||
        existsSync(join(schemaDir, 'edges.yaml'));
      if (alreadyExists) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            created: false,
            skipped: true,
            reason:
              'schema 已存在（entities.yaml 或 edges.yaml），为避免覆盖用户定义不做任何写入',
            schemaDir,
            mode: 'constrained',
          })
        );
        return;
      }

      const stats = await graph.getStats();
      const distinctTypes = Object.keys(stats.byType);

      if (!confirm) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            created: false,
            requiresConfirmation: true,
            schemaDir,
            currentMode: 'freeform',
            willWrite: ['entities.yaml', 'edges.yaml', 'xref.yaml'],
            defaultEntityWhitelist: ['note', 'person', 'project', 'topic'],
            preview: {
              totalEdges: stats.totalEdges,
              distinctEdgeTypes: distinctTypes.length,
            },
            note: '确认后模式将由 freeform 变为 constrained：存量边不会被删除，但后续抽取只保留新白名单内的类型',
          })
        );
        return;
      }

      // 显式确认 → 触发 ensureDefaults 写盘（本 handler 是唯一的写盘入口）
      await loader.loadAll();
      const written =
        existsSync(join(schemaDir, 'entities.yaml')) ||
        existsSync(join(schemaDir, 'edges.yaml'));
      if (!written) {
        // ensureDefaults 只在"目录不存在"时写入；目录已存在（哪怕为空）会直接 return
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            created: false,
            skipped: true,
            reason:
              'schema 目录已存在但为空 → ensureDefaults 仅在该目录不存在时写入；请先移除空目录后重试',
            schemaDir,
          })
        );
        return;
      }
      const [entities, edges] = await Promise.all([
        loader.loadEntities(),
        loader.loadEdges(),
      ]);
      const whitelist = new Set(edges.keys());
      const impacted = distinctTypes
        .filter((t) => !whitelist.has(t))
        .map((t) => ({ type: t, count: stats.byType[t] ?? 0 }))
        .sort((a, b) => b.count - a.count);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          created: true,
          mode: 'constrained',
          schemaDir,
          counts: { entities: entities.size, edges: edges.size },
          impact: {
            totalEdges: stats.totalEdges,
            impactedEdgeTypes: impacted.length,
            impactedEdges: impacted.reduce((sum, i) => sum + i.count, 0),
            topImpacted: impacted.slice(0, 10),
          },
          note: '存量边未被删除；影响体现在后续抽取（白名单外类型会被丢弃）',
        })
      );
    } finally {
      await graph.close();
    }
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:schema',
      action: 'scaffold_schema',
    });
    sendError(res, (err as Error).message, 500);
  }
}
