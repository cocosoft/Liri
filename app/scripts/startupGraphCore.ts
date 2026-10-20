/**
 * startupGraphCore.ts — **启动面静态图**的纯逻辑（analyze / lint 共用，避免两份口径漂移）
 *
 * 口径（与 `dev_docs/20261020/静态导入图瘦身-方案.md` §1.1 一致）：
 * - **eager 图** = 从入口出发、**只走非 `dynamic-import` 边**可达的文件集合；
 *   `dynamic-import` 的目标及其子图**不计入**（那正是"启动时不加载"的语义）。
 * - 规模以 metafile 的 `bytes`（源码字节）计，不折算运行时内存。
 *
 * 本文件**只做纯计算**（无 IO、无构建），供：
 * - `scripts/analyze-startup-graph.ts`（人读报告 + 生成基线）
 * - `scripts/lint-startup-graph.ts`（CI 棘轮门禁）
 * - `tests/gates/startupGraphRatchet.test.ts`（负向自证）
 */

/** metafile 的一条 import 边 */
export interface StartupMetaImport {
  path: string;
  /** `import-statement` / `require-call` / `dynamic-import` … */
  kind: string;
}

/** metafile 的一个输入文件 */
export interface StartupMetaInput {
  bytes?: number;
  imports?: StartupMetaImport[];
}

/** `bun build --metafile` 的最小结构 */
export interface StartupMeta {
  inputs: Record<string, StartupMetaInput>;
}

/** 文件数 / 字节 */
export interface SizeStat {
  files: number;
  bytes: number;
}

/** eager 图汇总 */
export interface EagerSummary {
  entry: string;
  /** eager 文件总数（app/src + node_modules + 其它） */
  total: number;
  app: SizeStat;
  nodeModules: SizeStat;
  /** app/src 按顶层目录（`src/<top>/…` ⇒ `<top>`） */
  byTopDir: Record<string, SizeStat>;
}

/** 基线文件结构（`.trae/architecture/startup-graph-baseline.json`） */
export interface StartupGraphBaseline {
  version: number;
  recordedAt?: string;
  entry: string;
  eager: {
    total: number;
    app: SizeStat;
    nodeModules: SizeStat;
  };
  byTopDir: Record<string, SizeStat>;
  /** 分析器附加字段（门禁不消费） */
  declaredOnDemandInEager?: Record<string, unknown>;
  nodeModulesByPackage?: Array<{ name: string; bytes: number }>;
}

/** 棘轮比较结果 */
export interface StartupGraphComparison {
  problems: string[];
  /** 已缩小（提示下调基线以锁定成果）；无缩小 ⇒ null */
  shrink: string | null;
}

/** 从入口做 BFS，只走非动态边 */
export function buildEagerGraph(
  meta: StartupMeta,
  entry: string
): Set<string> {
  const eager = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const info = meta.inputs[current];
    if (!info) continue;
    for (const imp of info.imports ?? []) {
      if (imp.kind === 'dynamic-import') continue;
      if (!meta.inputs[imp.path]) continue; // external / 未打包
      if (eager.has(imp.path)) continue;
      eager.add(imp.path);
      queue.push(imp.path);
    }
  }
  return eager;
}

/** 路径 → 归属：`src/<top>/…` ⇒ `<top>`；node_modules ⇒ `node_modules` */
export function bucketOf(path: string): string {
  const norm = path.split('\\').join('/');
  if (norm.startsWith('src/')) {
    const rest = norm.slice('src/'.length);
    return rest.includes('/') ? rest.split('/')[0] : '(root)';
  }
  if (norm.includes('node_modules/')) return 'node_modules';
  return 'other';
}

/** 汇总 eager 图（确定性：只依赖集合与 metafile） */
export function summarizeEager(
  meta: StartupMeta,
  entry: string
): EagerSummary {
  const eager = buildEagerGraph(meta, entry);
  const byTopDir: Record<string, SizeStat> = {};
  const summary: EagerSummary = {
    entry,
    total: eager.size,
    app: { files: 0, bytes: 0 },
    nodeModules: { files: 0, bytes: 0 },
    byTopDir,
  };

  for (const path of eager) {
    const bytes = meta.inputs[path]?.bytes ?? 0;
    const bucket = bucketOf(path);
    if (bucket === 'node_modules') {
      summary.nodeModules.files++;
      summary.nodeModules.bytes += bytes;
      continue;
    }
    if (bucket === 'other') continue;
    summary.app.files++;
    summary.app.bytes += bytes;
    const stat = byTopDir[bucket] ?? { files: 0, bytes: 0 };
    stat.files++;
    stat.bytes += bytes;
    byTopDir[bucket] = stat;
  }
  return summary;
}

/** 基线字段校验（不得静默通过） */
function validateBaseline(
  baseline: StartupGraphBaseline
): string | null {
  const bad = (field: string): string => `非法基线：${field} 缺失或非数字`;
  if (!Number.isFinite(baseline?.version)) return bad('version');
  if (typeof baseline.entry !== 'string' || !baseline.entry)
    return bad('entry');
  if (!Number.isFinite(baseline.eager?.total)) return bad('eager.total');
  if (!Number.isFinite(baseline.eager?.app?.files)) return bad('eager.app.files');
  if (!Number.isFinite(baseline.eager?.app?.bytes)) return bad('eager.app.bytes');
  if (!Number.isFinite(baseline.eager?.nodeModules?.files))
    return bad('eager.nodeModules.files');
  if (!Number.isFinite(baseline.eager?.nodeModules?.bytes))
    return bad('eager.nodeModules.bytes');
  if (typeof baseline.byTopDir !== 'object' || baseline.byTopDir === null)
    return bad('byTopDir');
  return null;
}

/**
 * 棘轮比较：**只减不增**
 *
 * 拦增量：总文件数 / app 文件数 / app 字节 / node_modules 字节 / 每个顶层目录的文件数。
 * 不拦"目录间搬文件"（那会同时改变两个目录的 files，属可见变更，由人判断）。
 */
export function compareStartupGraph(
  current: EagerSummary,
  baseline: StartupGraphBaseline
): StartupGraphComparison {
  const invalid = validateBaseline(baseline);
  if (invalid) return { problems: [invalid], shrink: null };

  if (current.entry !== baseline.entry) {
    return {
      problems: [
        `入口不一致：实测 ${current.entry}，基线 ${baseline.entry}` +
          '（不同入口的图不可比，请用 --update 重建基线）',
      ],
      shrink: null,
    };
  }

  const problems: string[] = [];
  const grew = (
    label: string,
    got: number,
    base: number,
    unit: string
  ): void => {
    if (got > base) {
      problems.push(
        `${label} 增加：${base} → ${got} ${unit}（+${got - base}）；棘轮只允许减少`
      );
    }
  };

  grew('eager 文件总数', current.total, baseline.eager.total, '个');
  grew('app/src 文件数', current.app.files, baseline.eager.app.files, '个');
  grew('app/src 字节', current.app.bytes, baseline.eager.app.bytes, 'B');
  grew(
    'node_modules 字节',
    current.nodeModules.bytes,
    baseline.eager.nodeModules.bytes,
    'B'
  );

  for (const [dir, stat] of Object.entries(current.byTopDir)) {
    const base = baseline.byTopDir[dir];
    if (!base) {
      problems.push(
        `新增顶层目录 \`${dir}\`（${stat.files} 文件）进入启动图；棘轮只允许减少`
      );
      continue;
    }
    grew(`目录 \`${dir}\` 文件数`, stat.files, base.files, '个');
  }

  const shrink =
    current.total < baseline.eager.total
      ? `已缩小：eager 文件 ${baseline.eager.total} → ${current.total}；建议 --update 下调基线以锁定成果`
      : null;

  return { problems, shrink };
}

/** 由汇总构造基线对象（供 `--update` / analyze 落盘复用） */
export function toBaseline(
  summary: EagerSummary,
  extras: Partial<StartupGraphBaseline> = {}
): StartupGraphBaseline {
  return {
    version: 1,
    recordedAt: new Date().toISOString(),
    entry: summary.entry,
    eager: {
      total: summary.total,
      app: summary.app,
      nodeModules: summary.nodeModules,
    },
    byTopDir: summary.byTopDir,
    ...extras,
  };
}
