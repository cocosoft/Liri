/**
 * LineageView — 本次编译血缘（方案 B v7 §4.4）
 *
 * 数据源：GET /v1/knowledge/lineage?domain=<目标域>
 * 展示 raw/编译页 → page / record / rule / node 的产物链（LineageStore 记录，绑 compileVersion）。
 *
 * 与 stepper 的分工：stepper 回答"现在跑到哪一步"，血缘树回答"这些产物从哪来"。
 * 为控渲染规模：默认按 docPath 分组，最多渲染 30 组，本地支持按路径/产物 ID 过滤。
 *
 * D6-5：`domain` 由调用方传入（与编译目标域一致）——硬编码 `knowledge` 时，
 * 编译进其它域后本面板会显示空血缘（"编译了但看不到产物"）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { knowledgeService } from "../../../services/knowledgeService";
import type {
  KnowledgeLineageLink,
  LineageArtifactType,
} from "../../../services/knowledgeService";

/** 单次最多渲染的血缘组数（防大库一次渲染上千节点） */
const MAX_GROUPS = 30;

const ARTIFACT_LABEL: Record<LineageArtifactType, string> = {
  page: "页面",
  record: "记录",
  rule: "规则",
  node: "图谱节点",
};

export function LineageView({
  active,
  domain,
}: {
  active: boolean;
  /** 目标域（与编译入口一致） */
  domain: string;
}) {
  const [links, setLinks] = useState<KnowledgeLineageLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await knowledgeService.getLineage({ domain });
      setLinks(res.links);
    } catch (e) {
      setLinks([]);
      setLoadError(e instanceof Error ? e.message : "血缘查询失败");
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    if (!active || !expanded) return;
    void load();
  }, [active, expanded, load]);

  const groups = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    const map = new Map<string, KnowledgeLineageLink[]>();
    for (const l of links) {
      if (
        kw &&
        !l.docPath.toLowerCase().includes(kw) &&
        !l.artifactId.toLowerCase().includes(kw)
      ) {
        continue;
      }
      const arr = map.get(l.docPath);
      if (arr) arr.push(l);
      else map.set(l.docPath, [l]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [links, filter]);

  const shown = groups.slice(0, MAX_GROUPS);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <span>
          血缘（产物来源）
          {expanded && !loading ? ` · ${groups.length} 个源文档` : ""}
        </span>
        <span className="text-gray-400">{expanded ? "收起" : "展开"}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="按源路径 / 产物 ID 过滤"
              className="w-64 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              刷新
            </button>
          </div>

          {loading && <div className="text-xs text-gray-400">加载中…</div>}
          {!loading && loadError && (
            <div className="text-xs text-red-500">{loadError}</div>
          )}
          {!loading && !loadError && groups.length === 0 && (
            <div className="text-xs text-gray-400">
              暂无血缘记录（编译产出页面/记录/规则后才会写入）
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            {shown.map(([docPath, items]) => (
              <div
                key={docPath}
                className="border-b border-gray-100 py-1.5 last:border-0 dark:border-gray-800"
              >
                <div className="truncate text-xs text-gray-700 dark:text-gray-200">
                  {docPath}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {items.slice(0, 20).map((it, i) => (
                    <span
                      key={`${it.artifactType}:${it.artifactId}:${i}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      title={`v${it.version}`}
                    >
                      {ARTIFACT_LABEL[it.artifactType]} · {it.artifactId}
                    </span>
                  ))}
                  {items.length > 20 && (
                    <span className="text-[10px] text-gray-400">
                      +{items.length - 20}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {groups.length > MAX_GROUPS && (
            <div className="mt-2 text-[11px] text-gray-400">
              仅显示前 {MAX_GROUPS} 个源文档（共 {groups.length}
              ），可用过滤缩小范围。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
