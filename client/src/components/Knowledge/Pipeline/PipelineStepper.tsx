/**
 * PipelineStepper — 知识加工流水线横向阶段条（方案 B v7）
 *
 * 8 个展示节点：准备（后端 scanning + cleaning 合并，避免几十毫秒级节点闪烁）、
 * LLM 编译、质量检查、图谱提取、记录抽取、规则抽取、分块刷新、索引落账。
 *
 * 五态：已完成 / 进行中 / 已触发（indexing 专用）/ 已跳过（附原因）/ 待执行。
 * 后端契约仍是 9 阶段，本组件只做展示层合并（不动后端）。
 */
import type {
  CompilePhase,
  PhaseSnapshot,
  PhaseSkipReason,
  PhaseStatus,
} from "../../../services/knowledgeService";

interface DisplayGroup {
  key: string;
  label: string;
  phases: CompilePhase[];
}

const DISPLAY_GROUPS: DisplayGroup[] = [
  { key: "prepare", label: "准备", phases: ["scanning", "cleaning"] },
  { key: "compiling", label: "LLM 编译", phases: ["compiling"] },
  { key: "linting", label: "质量检查", phases: ["linting"] },
  { key: "graph_extract", label: "图谱提取", phases: ["graph_extract"] },
  { key: "record_extract", label: "记录抽取", phases: ["record_extract"] },
  { key: "rule_extract", label: "规则抽取", phases: ["rule_extract"] },
  { key: "chunk_refresh", label: "分块刷新", phases: ["chunk_refresh"] },
  { key: "indexing", label: "索引落账", phases: ["indexing"] },
];

const SKIP_TEXT: Record<PhaseSkipReason, string> = {
  gated: "未触发",
  busy: "任务占用",
  memory: "内存水位",
  truncated: "已截断",
  empty: "无数据",
  aborted: "已中止",
};

/** 组状态派生：running > triggered > 全终态(=done) > 全 skipped > pending */
function deriveGroupStatus(children: PhaseSnapshot[]): PhaseStatus {
  if (children.length === 0) return "pending";
  if (children.some((c) => c.status === "running")) return "running";
  if (children.some((c) => c.status === "triggered")) return "triggered";
  if (children.every((c) => c.status === "skipped")) return "skipped";
  if (
    children.every(
      (c) =>
        c.status === "done" ||
        c.status === "skipped" ||
        c.status === "triggered",
    )
  ) {
    return "done";
  }
  return "pending";
}

function StatusDot({ status }: { status: PhaseStatus }) {
  const base =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium";
  switch (status) {
    case "done":
      return <span className={`${base} bg-emerald-500 text-white`}>✓</span>;
    case "running":
      return (
        <span className={`${base} bg-blue-500 text-white`}>
          <span className="h-2 w-2 animate-ping rounded-full bg-white" />
        </span>
      );
    case "triggered":
      return <span className={`${base} bg-violet-500 text-white`}>~</span>;
    case "skipped":
      return (
        <span
          className={`${base} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`}
        >
          –
        </span>
      );
    default:
      return (
        <span
          className={`${base} bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400`}
        >
          ·
        </span>
      );
  }
}

export function PipelineStepper({ phases }: { phases: PhaseSnapshot[] }) {
  const byPhase = new Map(phases.map((p) => [p.phase, p]));

  return (
    <div className="flex items-start overflow-x-auto pb-1">
      {DISPLAY_GROUPS.map((group, idx) => {
        const children = group.phases
          .map((p) => byPhase.get(p))
          .filter((p): p is PhaseSnapshot => Boolean(p));
        const status = deriveGroupStatus(children);
        const active = children.find((c) => c.status === "running");
        const skipped = children.find((c) => c.status === "skipped");
        const detail = active?.detail;
        const subtitle =
          detail && detail.total > 0
            ? `${detail.current}/${detail.total}`
            : status === "skipped" && skipped?.skipReason
              ? SKIP_TEXT[skipped.skipReason]
              : status === "triggered"
                ? "已触发"
                : "";

        return (
          <div key={group.key} className="flex items-start">
            <div className="flex w-20 flex-col items-center gap-1">
              <StatusDot status={status} />
              <span
                className={`text-center text-[11px] leading-tight ${
                  status === "pending"
                    ? "text-gray-400 dark:text-gray-500"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                {group.label}
              </span>
              <span className="h-3 text-[10px] text-gray-500 dark:text-gray-400">
                {subtitle}
              </span>
            </div>
            {idx < DISPLAY_GROUPS.length - 1 && (
              <div
                className={`mt-3 h-px w-6 shrink-0 ${
                  status === "done"
                    ? "bg-emerald-400"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
