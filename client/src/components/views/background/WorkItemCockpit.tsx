/**
 * 工作项驾驶舱（P39-b-2，2026-11-02）
 *
 * 位置：嵌入「运行状况」页（`BackgroundStatusPage`），**不新增页面/路由/导航入口**。
 *
 * 三问的落点：
 * - 是否需要人 → 「待你处理」Tab（`person:*`）+ 人工介入率；
 * - 系统是否健康 → 完成率 / 回传中 / 投递失败（无样本显示 —）；
 * - 一件工作的历史 → 卡片「详情」按需加载派工 + 执行记录。
 *
 * 诚实边界：数字来自 `groups`（分组只输出非空），Tab 计数 = 对应列表长度；
 * 指标缺样本时渲染 `—`，不按 0 计。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  cockpitService,
  type CockpitGroupDto,
  type CockpitItemDto,
  type CockpitSnapshotDto,
} from "../../../services/cockpitService";
import { HTTPClientError } from "../../../services/httpClient";
import { useSessionStore } from "@/stores/sessionStore";
import WorkItemHistory from "./WorkItemHistory";

type TabKey = "person" | "active" | "ended";

const TABS: Array<{ key: TabKey; labelKey: string; emptyKey: string }> = [
  { key: "person", labelKey: "tabPerson", emptyKey: "emptyPerson" },
  { key: "active", labelKey: "tabActive", emptyKey: "emptyActive" },
  { key: "ended", labelKey: "tabEnded", emptyKey: "emptyEnded" },
];

/** stage 键 → i18n 短名（后端 `group.label` 仅作未知键的兜底） */
const STAGE_LABEL_KEYS: Record<string, string> = {
  "person:delivery": "stageDelivery",
  "person:answer": "stageAnswer",
  "person:review": "stageReview",
  "person:blocked": "stageBlocked",
  "person:failed": "stageFailed",
  "working:queued": "stageQueued",
  working: "stageWorking",
  ended: "stageEnded",
};

interface StagedItem {
  item: CockpitItemDto;
  stageKey: string;
  fallbackLabel: string;
}

function collect(
  groups: readonly CockpitGroupDto[],
  match: (key: string) => boolean,
): StagedItem[] {
  const out: StagedItem[] = [];
  for (const group of groups) {
    if (!match(group.key)) continue;
    for (const item of group.items) {
      out.push({
        item,
        stageKey: group.key,
        fallbackLabel: group.label,
      });
    }
  }
  return out;
}

function stageTone(stageKey: string): string {
  if (stageKey === "person:failed") {
    return "text-red-600 dark:text-red-400";
  }
  if (stageKey.startsWith("person:")) {
    return "text-amber-600 dark:text-amber-400";
  }
  return "text-gray-500 dark:text-gray-400";
}

export default function WorkItemCockpit({
  refreshToken = 0,
}: {
  refreshToken?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<CockpitSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("person");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [takeoverErrors, setTakeoverErrors] = useState<Record<string, string>>(
    {},
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await cockpitService.getSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const person = useMemo(
    () => collect(data?.groups ?? [], (key) => key.startsWith("person:")),
    [data],
  );
  const active = useMemo(
    () =>
      collect(
        data?.groups ?? [],
        (key) => key === "working" || key === "working:queued",
      ),
    [data],
  );
  const ended = useMemo(
    () => collect(data?.groups ?? [], (key) => key === "ended"),
    [data],
  );

  const itemsByTab: Record<TabKey, StagedItem[]> = {
    person,
    active,
    ended,
  };

  const labelOf = (staged: StagedItem): string => {
    const key = STAGE_LABEL_KEYS[staged.stageKey];
    return key ? t(`backgroundStatus.workItems.${key}`) : staged.fallbackLabel;
  };

  /** P33：策略变更提示文案（三类效果拼成一句；无效果 ⇒ null） */
  const policyEffectOf = (item: CockpitItemDto): string | null => {
    const effect = item.policyEffect;
    if (!effect) return null;
    const parts: string[] = [];
    if (effect.rules?.length) {
      parts.push(
        t("backgroundStatus.workItems.policyEffectRules", {
          ids: effect.rules
            .map((rule) => `${rule.id}(${rule.change})`)
            .join(", "),
        }),
      );
    }
    if (effect.requesterAllowed === false) {
      parts.push(t("backgroundStatus.workItems.policyEffectRequester"));
    }
    if (effect.proactive === false) {
      parts.push(t("backgroundStatus.workItems.policyEffectProactive"));
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  const handleTakeover = async (item: CockpitItemDto): Promise<void> => {
    setBusyId(item.id);
    setTakeoverErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const target = await cockpitService.takeover(item.id);
      // 与聊天内「进入工作模式」同路径：先切会话，再回对话页
      await useSessionStore.getState().switchSession(target.sessionId);
      navigate("/");
    } catch (e) {
      const message =
        e instanceof HTTPClientError && e.status === 409
          ? t("backgroundStatus.workItems.takeoverNoSession")
          : e instanceof Error
            ? e.message
            : String(e);
      setTakeoverErrors((prev) => ({ ...prev, [item.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  const metrics = data?.metrics;
  const effects = data?.effects ?? null;
  const humanRate =
    metrics && metrics.total > 0
      ? `${Math.round(metrics.humanInterventionRate * 100)}%`
      : t("backgroundStatus.workItems.noSample");
  const completion =
    metrics?.completionRate === undefined
      ? t("backgroundStatus.workItems.noSample")
      : `${Math.round(metrics.completionRate * 100)}%`;
  const attempting =
    effects === null
      ? t("backgroundStatus.workItems.noSample")
      : String(effects.attempting);
  const effectFailed =
    effects === null
      ? t("backgroundStatus.workItems.noSample")
      : String(effects.failed);

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("backgroundStatus.workItems.title")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t("backgroundStatus.workItems.desc")}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {t("common.refresh")}
        </button>
      </div>

      {loading && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">
          {t("common.loading")}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {t("backgroundStatus.workItems.loadFailed", { error })}
          <button
            onClick={() => void load()}
            className="ml-2 underline hover:no-underline"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t("backgroundStatus.workItems.metricHuman")}
              </div>
              <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {humanRate}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t("backgroundStatus.workItems.metricCompletion")}
              </div>
              <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {completion}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t("backgroundStatus.workItems.metricAttempting")}
              </div>
              <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {attempting}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t("backgroundStatus.workItems.metricEffectFailed")}
              </div>
              <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                {effectFailed}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                onClick={() => setTab(entry.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === entry.key
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t(`backgroundStatus.workItems.${entry.labelKey}`)}
                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                  {itemsByTab[entry.key].length}
                </span>
              </button>
            ))}
          </div>

          {itemsByTab[tab].length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              {t(
                `backgroundStatus.workItems.${
                  TABS.find((entry) => entry.key === tab)?.emptyKey ??
                  "emptyPerson"
                }`,
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {itemsByTab[tab].map((staged) => {
                const item = staged.item;
                const expanded = expandedId === item.id;
                const policyDetail = policyEffectOf(item);
                return (
                  <li
                    key={item.id}
                    className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 ${stageTone(staged.stageKey)}`}
                          >
                            {labelOf(staged)}
                          </span>
                          {typeof item.costTokens === "number" && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {t("backgroundStatus.workItems.costTokens", {
                                n: item.costTokens,
                              })}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1 truncate">
                          {item.title || item.id}
                        </div>
                        {item.lastAction && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {t("backgroundStatus.workItems.lastAction", {
                              action: item.lastAction,
                            })}
                          </div>
                        )}
                        {policyDetail && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 min-w-0">
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex-shrink-0">
                              {t("backgroundStatus.workItems.policyEffect")}
                            </span>
                            <span className="truncate">{policyDetail}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() =>
                            setExpandedId(expanded ? null : item.id)
                          }
                          className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          {expanded
                            ? t("backgroundStatus.workItems.hideDetail")
                            : t("backgroundStatus.workItems.detail")}
                        </button>
                        <button
                          onClick={() => void handleTakeover(item)}
                          disabled={!item.sessionId || busyId === item.id}
                          title={
                            item.sessionId
                              ? t("backgroundStatus.workItems.takeover")
                              : t(
                                  "backgroundStatus.workItems.takeoverNoSession",
                                )
                          }
                          className="px-2.5 py-1 text-xs rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {t("backgroundStatus.workItems.takeover")}
                        </button>
                      </div>
                    </div>

                    {takeoverErrors[item.id] && (
                      <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {takeoverErrors[item.id]}
                      </div>
                    )}

                    {expanded && <WorkItemHistory workItemId={item.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
