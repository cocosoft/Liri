/**
 * KnowledgePipelinePage — 知识加工流水线页（方案 B v7）
 *
 * 两个可视化维度：
 * - 过程：9 阶段 stepper（真实阶段广播，非伪动画）
 * - 结果：入料量 / 质量分 / 索引条目 / 本轮编译结果
 *
 * 数据源全部为既有接口，无 mock。
 * 支持「全部编译」与「指定文档编译」（后者仅处理选中文件，对目标文件强制重编）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { knowledgeService } from "../../../services/knowledgeService";
import { semanticService } from "../../../services/semanticService";
import { schemaService } from "../../../services/schemaService";
import { useKnowledgeStore } from "../../../stores/knowledgeStore";
import type { OntologyDomainItem } from "../../../types/project";
import { PipelineStepper } from "./PipelineStepper";
import { LineageView } from "./LineageView";
import { useCompilePhaseStream } from "./useCompilePhaseStream";
import { useCompilePolling } from "../useCompilePolling";

const PHASE_ROW_LABEL: Record<string, string> = {
  scanning: "扫描入料",
  cleaning: "清理产物",
  compiling: "LLM 编译",
  linting: "质量检查",
  graph_extract: "图谱提取",
  record_extract: "记录抽取",
  rule_extract: "规则抽取",
  chunk_refresh: "分块刷新",
  indexing: "索引落账",
};

const SKIP_TEXT: Record<string, string> = {
  gated: "未触发",
  busy: "任务占用",
  memory: "内存水位",
  truncated: "已截断",
  empty: "无数据",
  aborted: "已中止",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-100">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
          {hint}
        </div>
      )}
    </div>
  );
}

export function KnowledgePipelinePage({ active }: { active: boolean }) {
  const { progress, loading, refresh } = useCompilePhaseStream();
  const [rawCount, setRawCount] = useState<number | null>(null);
  /** raw 文件名列表（指定文档编译用） */
  const [rawFiles, setRawFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [docFilter, setDocFilter] = useState("");
  const [lintScore, setLintScore] = useState<number | null>(null);
  const [indexCounts, setIndexCounts] = useState<{
    docCount: number;
    chunkCount: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // D6-5：编译目标域 —— 单一事实来源在 store（知识库页 / 待编译面板共用）
  const compileDomain = useKnowledgeStore((s) => s.list.compileDomain);
  const dispatchList = useKnowledgeStore((s) => s.dispatchList);
  const [domains, setDomains] = useState<OntologyDomainItem[]>([]);

  // D6-5：域清单（后端保证"默认域"始终在列表内）；取不到时仅剩当前值，不阻塞本页
  useEffect(() => {
    void (async () => {
      try {
        const data = await schemaService.listDomains();
        setDomains(data.domains);
      } catch {
        // @ignore-catch 域清单是辅助信息（选择器仍可用当前值编译）
      }
    })();
  }, []);

  /** 下拉可选项：域清单 ∪ 当前值（清单未就绪/失焦时不丢当前选择） */
  const domainChoices = useMemo(() => {
    const names = domains.map((d) => d.name);
    return names.includes(compileDomain) ? names : [compileDomain, ...names];
  }, [domains, compileDomain]);

  const loadMetrics = useCallback(async () => {
    try {
      const raw = await knowledgeService.getRawFiles();
      // 指标口径修复（浏览器实测发现）：totalCount 含 .meta.json 与不可编译文件
      // （现场 928 vs 实际可编译 173），"待编译入料"必须用可编译数才不误导
      const compilable = raw.files.filter((f) => f.compilable);
      setRawCount(compilable.length);
      // 仅列出可编译文件（后端按 COMPILABLE_EXTENSIONS 标注）——否则会列出
      // .pdf/.zip 等选中后无法编译的条目，点了没反应
      setRawFiles(compilable.map((f) => f.fileName));
    } catch {
      setRawCount(null);
      setRawFiles([]);
    }
    try {
      const h = await knowledgeService.health();
      setLintScore(h.lintScore);
    } catch {
      setLintScore(null);
    }
    // 复用既有 semanticService（CS01）：不新增 getSemanticIndexStatus 重复实现
    const st = await semanticService.getStatus();
    setIndexCounts(
      st ? { docCount: st.docCount, chunkCount: st.chunkCount } : null,
    );
  }, []);

  // 本页在 KnowledgePage 中常驻挂载（display:none），必须用 active 门控：
  // health() 会做全库扫描，若在应用启动时无条件调用会造成无谓开销
  useEffect(() => {
    if (!active) return;
    void loadMetrics();
  }, [active, loadMetrics]);

  // 编译结束（进入终态）后刷新指标
  useEffect(() => {
    if (!active) return;
    if (progress?.status === "done") void loadMetrics();
  }, [active, progress?.status, loadMetrics]);

  const { start } = useCompilePolling({
    onResult: (r) => setNotice(r.message),
    onFinished: () => {
      void refresh();
    },
  });

  const compiling = progress?.status === "compiling";
  const last = progress?.lastSession ?? null;
  // 空闲态复盘：60s 复位会清空 phases[]，此时回落到上次会话摘要（lastSession）
  const phases =
    progress && progress.phases.length > 0
      ? progress.phases
      : (last?.phases ?? []);
  const result = progress?.result ?? last?.result ?? null;
  const errorCount = result?.errors ?? 0;
  const errorSamples = result?.errorSamples ?? [];
  const isReview =
    !compiling && (progress?.phases.length ?? 0) === 0 && last !== null;

  const filteredRawFiles = useMemo(() => {
    const kw = docFilter.trim().toLowerCase();
    return kw ? rawFiles.filter((f) => f.toLowerCase().includes(kw)) : rawFiles;
  }, [rawFiles, docFilter]);

  const toggleSelected = (fileName: string) => {
    setSelected((prev) =>
      prev.includes(fileName)
        ? prev.filter((f) => f !== fileName)
        : [...prev, fileName],
    );
  };

  /** 指定文档编译：后端仅编译选中文件，且对目标文件强制重编 */
  const compileSelected = () => {
    if (selected.length === 0 || compiling) return;
    setNotice(null);
    // D6-5：透传目标域
    void start(selected, compileDomain);
  };

  // 空跑判定：本轮无文件变更 → 未产出新页面 → 尾部阶段全部按门控跳过（正常，非失败）
  const tailPhases = phases.filter(
    (p) =>
      p.phase !== "scanning" &&
      p.phase !== "cleaning" &&
      p.phase !== "compiling",
  );
  const noopRun =
    !compiling &&
    progress?.status === "done" &&
    tailPhases.length > 0 &&
    tailPhases.every((p) => p.status === "skipped" && p.skipReason === "gated");

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            知识加工流水线
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {compiling
              ? `正在加工 · 会话 #${progress?.sessionId ?? 0}`
              : last
                ? last.outcome === "aborted"
                  ? `空闲 · 上次编译中止于 ${fmtTime(last.finishedAt)}：${last.lastError ?? "未知原因"}`
                  : `空闲 · 上次编译 ${fmtTime(last.finishedAt)}（用时 ${fmtDuration(last.durationMs) || "—"}）`
                : progress?.status === "done"
                  ? "本次编译刚结束"
                  : "暂无编译记录"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* D6-5：目标域选择（唯一编辑入口；知识库页 / 待编译面板共用该值） */}
          <div
            className="flex items-center gap-1.5"
            title="编译产物写入该域：用该域的本体（.schema）约束抽取；域未声明本体时回落全局"
          >
            <span className="text-xs text-gray-500 dark:text-gray-400">
              目标域
            </span>
            <select
              value={compileDomain}
              disabled={compiling}
              onChange={(event) =>
                dispatchList({
                  type: "SET_COMPILE_DOMAIN",
                  domain: event.target.value,
                })
              }
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            >
              {domainChoices.map((name) => (
                <option key={name} value={name}>
                  域：{name}
                  {name === "knowledge" ? "（默认）" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            刷新
          </button>
          <button
            type="button"
            disabled={compiling}
            onClick={() => {
              setNotice(null);
              // D6-5：透传目标域
              void start(undefined, compileDomain);
            }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {compiling ? "编译中…" : "全部编译"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {notice}
        </div>
      )}

      {errorCount > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-medium">本轮有 {errorCount} 个文件编译失败</div>
          {errorSamples.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {errorSamples.map((e, i) => (
                <li key={i} className="truncate font-mono" title={e}>
                  {e}
                </li>
              ))}
            </ul>
          )}
          {errorCount > errorSamples.length && (
            <div className="mt-1 text-[11px] text-red-600 dark:text-red-300">
              仅显示前 {errorSamples.length} 条，完整信息见日志
            </div>
          )}
        </div>
      )}

      {isReview && (
        <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          当前无进行中的编译会话，以下为上次会话 #{last?.sessionId} 的终态快照。
        </div>
      )}

      {noopRun && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          本轮<strong>无文件变更</strong>，未产出新页面 —— 因此质量检查 /
          图谱提取 / 记录抽取 / 规则抽取 / 分块刷新 / 索引落账
          均无需执行（尾部阶段按门控
          跳过，属正常，非失败）。如需强制重编请使用「全部编译」（force）。
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        {loading ? (
          <div className="text-xs text-gray-400">加载中…</div>
        ) : phases.length === 0 ? (
          <div className="text-xs text-gray-400">暂无编译记录</div>
        ) : (
          <PipelineStepper phases={phases} />
        )}
      </div>

      {phases.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
            阶段明细
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {phases.map((p) => (
              <div
                key={p.phase}
                className="flex items-center justify-between px-4 py-2 text-xs"
              >
                <span className="text-gray-700 dark:text-gray-200">
                  {PHASE_ROW_LABEL[p.phase] ?? p.phase}
                </span>
                <span className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                  {p.detail && p.detail.total > 0 && (
                    <span>
                      {p.detail.current}/{p.detail.total}
                    </span>
                  )}
                  {p.status === "skipped" && p.skipReason && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {SKIP_TEXT[p.skipReason] ?? p.skipReason}
                    </span>
                  )}
                  {p.status === "running" && (
                    <span className="text-blue-600 dark:text-blue-400">
                      进行中
                    </span>
                  )}
                  {p.status === "done" && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      完成
                    </span>
                  )}
                  {p.status === "pending" && <span>待执行</span>}
                  {p.status === "triggered" && (
                    <span className="text-violet-600 dark:text-violet-400">
                      已触发
                    </span>
                  )}
                  <span className="w-12 text-right">
                    {fmtDuration(p.durationMs)}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {phases.some(
            (p) => p.phase === "indexing" && p.status === "triggered",
          ) && (
            <div className="border-t border-gray-200 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
              注：索引已触发 —— 倒排索引与语义索引均按本次产出的页面增量更新。
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="待编译入料"
          value={rawCount === null ? "—" : String(rawCount)}
          hint="raw/ 可编译文件数"
        />
        <Metric
          label="质量分"
          value={lintScore === null ? "—" : String(lintScore)}
          hint="来自 /v1/knowledge/health"
        />
        <Metric
          label="语义索引"
          value={indexCounts === null ? "—" : String(indexCounts.docCount)}
          hint={
            indexCounts === null
              ? "索引状态不可用"
              : `${indexCounts.chunkCount} 个片段`
          }
        />
        <Metric
          label="本轮编译"
          value={
            result
              ? `${result.compiled}/${result.compiled + result.skipped}`
              : "—"
          }
          hint={
            result
              ? `${result.skipped} 跳过 · ${result.errors} 错误`
              : "尚无结果"
          }
        />
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
            指定文档编译
            {selected.length > 0 ? ` · 已选 ${selected.length}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <input
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              placeholder="筛选文件名"
              className="w-40 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <button
              type="button"
              onClick={() => setSelected([])}
              disabled={selected.length === 0}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              清空
            </button>
            <button
              type="button"
              onClick={compileSelected}
              disabled={selected.length === 0 || compiling}
              title={`仅编译选中文件（写入域：${compileDomain}）`}
              className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              编译选中（{selected.length}）
            </button>
          </div>
        </div>

        {rawFiles.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400">
            raw/ 目录暂无文件
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto px-4 py-2">
            {filteredRawFiles.length === 0 ? (
              <div className="py-2 text-xs text-gray-400">无匹配文件</div>
            ) : (
              filteredRawFiles.map((f) => (
                <label
                  key={f}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(f)}
                    onChange={() => toggleSelected(f)}
                    disabled={compiling}
                  />
                  <span className="truncate font-mono text-gray-700 dark:text-gray-200">
                    {f}
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        <div className="border-t border-gray-200 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-700 dark:text-gray-500">
          指定文档编译仅处理选中文件（对目标文件强制重编），不清理、不覆盖其余文件的产物与编译快照。
        </div>
      </div>

      {/* D6-5：血缘按目标域查询（编译进哪域就看哪域） */}
      <LineageView active={active} domain={compileDomain} />
    </div>
  );
}
