/**
 * 工作台页（路由 `/workbench`）—— 全站功能目录
 *
 * 2026-10-22 改造（用户反馈："30 个功能铺开，眼睛看花也找不到对应功能"）：
 * - **搜索优先**：顶部输入即筛（标题 + id + 同义词）—— 补上"记得名字就能直达"这条路径；
 * - **最近使用**：本地记录最近 6 个入口，不预设固定置顶（用真实使用频率代替主观猜测）；
 * - **分组默认收起**：只展开第一组，其余组显示条目数按需展开
 *   —— 一屏可见的选择从 30 项降到「1 组卡片 + 3 行组标题」；
 * - 侧栏 / 移动底栏的「工作台」不再内联展开 30 项抽屉，统一落到本页（一处工作面）。
 *
 * 数据来源：`@/config/navRegistry`（与侧栏/首页/移动端底栏共用同一份定义，单一事实来源）。
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { useRootStore } from "@/stores/root-store";
import { selectEnabledModules } from "@/stores/selectors";
import {
  toEnabledModuleIds,
  workbenchGroups,
  type NavEntry,
  type WorkbenchGroupId,
} from "@/config/navRegistry";
import { createLogger } from "@/utils/logger";
import { PreviewBadge } from "../common/PreviewBadge";

const logger = createLogger("components:workbench:directory");

/** 最近使用（本地记录，最多 6 条）。只存 id，标题始终以 navRegistry 为准 */
const RECENT_STORAGE_KEY = "liri.workbench.recent";
const RECENT_MAX = 6;

/**
 * 搜索同义词：只补"用户会说、但标题里没有"的词（中英混排常见）。
 * 标题本身与 `id` 已参与匹配，此处不再重复维护名称。
 */
const SEARCH_ALIASES: Record<string, string[]> = {
  "wb-agent": ["智能体", "agent"],
  "wb-council": ["角色", "role"],
  "wb-cron": ["定时", "计划", "schedule"],
  "wb-loops": ["循环", "自动化", "loop"],
  "wb-autoreply": ["自动回复", "reply"],
  "wb-office": ["办公", "文档", "邮件", "日历", "office"],
  "wb-media": ["媒体", "图片", "视频", "media"],
  "wb-models": ["模型", "供应商", "provider", "model"],
  "wb-skills": ["技能", "skill"],
  "wb-files": ["文件", "目录", "file"],
  "wb-mcp": ["工具", "mcp"],
  "wb-plugins": ["插件", "plugin"],
  "wb-channels": ["渠道", "接入", "微信", "飞书", "channel"],
  "wb-permissions": ["权限", "授权", "permission"],
  "wb-apikeys": ["密钥", "凭据", "key", "token"],
  "wb-oauth": ["登录", "授权", "oauth"],
  "wb-usage": ["用量", "成本", "花费", "计费", "token", "cost"],
  "wb-logs": ["日志", "排查", "log"],
  "wb-sandbox": ["沙箱", "隔离", "sandbox"],
  "wb-security": ["安全", "审计", "security"],
  "wb-terminal": ["终端", "命令行", "shell", "terminal"],
  "wb-help": ["帮助", "快捷键", "help"],
  "wb-user": ["账户", "个人", "profile"],
};

/** 读取最近使用（本地记录可能被旧版本写坏 ⇒ 按边界输入校验，失败即空） */
function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .slice(0, RECENT_MAX);
  } catch (err) {
    logger.warn("最近使用记录读取失败（按空处理）", { error: String(err) });
    return [];
  }
}

function writeRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids));
  } catch (err) {
    logger.warn("最近使用记录写入失败（仅影响下次进入的记忆）", {
      error: String(err),
    });
  }
}

/** 是否命中查询：多关键词按 AND，标题 / id / 同义词任一包含即算 */
function matchesQuery(
  entry: NavEntry,
  label: string,
  tokens: string[],
): boolean {
  if (tokens.length === 0) return true;
  const haystack = [label, entry.id, ...(SEARCH_ALIASES[entry.id] ?? [])]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export default function WorkbenchDirectoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // §4.3-7：为当前页对应条目补 aria-current（与侧栏/底栏同一语义）
  const { pathname } = useLocation();
  // §4.3-6：组内条目需过模块门控（base 档隐藏 pro 模块），集合由 selectEnabledModules 派生
  const enabledModules = useRootStore(useShallow(selectEnabledModules));
  const groups = useMemo(
    () =>
      workbenchGroups(toEnabledModuleIds(enabledModules)).filter(
        (group) => group.items.length > 0,
      ),
    [enabledModules],
  );

  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecent());
  // 默认只展开第一组：其余组收起，避免一屏 30 项同时争夺注意力
  const [expanded, setExpanded] = useState<ReadonlySet<WorkbenchGroupId>>(
    () => {
      const first = groups[0];
      return new Set<WorkbenchGroupId>(first ? [first.id] : []);
    },
  );

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const entryById = useMemo(() => {
    const map = new Map<string, NavEntry>();
    for (const group of groups) {
      for (const item of group.items) map.set(item.id, item);
    }
    return map;
  }, [groups]);

  // 最近使用：只保留"仍存在且当前 tier 可见"的条目（模块/清单变化后自动失效）
  const recentEntries = useMemo(
    () =>
      recentIds
        .map((id) => entryById.get(id))
        .filter((entry): entry is NavEntry => entry !== undefined),
    [recentIds, entryById],
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            matchesQuery(item, t(item.labelKey), tokens),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [groups, t, tokens],
  );

  /** 打开入口：记录到「最近使用」再跳转（无 path 的动作型条目不在此页出现） */
  const openEntry = useCallback(
    (id: string) => {
      const entry = entryById.get(id);
      if (!entry?.path) return;
      const next = [id, ...recentIds.filter((value) => value !== id)].slice(
        0,
        RECENT_MAX,
      );
      setRecentIds(next);
      writeRecent(next);
      navigate(entry.path);
    },
    [entryById, navigate, recentIds],
  );

  const toggleGroup = (id: WorkbenchGroupId): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderCard = (item: NavEntry) => {
    const ItemIcon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        aria-current={
          item.path && pathname === item.path.split("?")[0] ? "page" : undefined
        }
        onClick={() => openEntry(item.id)}
        className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-3 text-gray-700 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-500 dark:hover:bg-gray-700"
      >
        <ItemIcon size={20} />
        <span className="w-full truncate text-center text-xs flex items-center justify-center gap-1">
          {t(item.labelKey)}
          {item.preview && <PreviewBadge />}
        </span>
      </button>
    );
  };

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="shrink-0 text-lg font-semibold text-gray-800 dark:text-gray-100">
            {t("sidebar.workbench")}
          </h1>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workbench.searchPlaceholder")}
            aria-label={t("workbench.searchPlaceholder")}
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>

        {recentEntries.length > 0 && tokens.length === 0 && (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("workbench.recent")}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {recentEntries.map(renderCard)}
            </div>
          </section>
        )}

        {visibleGroups.map((group) => {
          const Icon = group.items[0]?.icon;
          // 搜索态强制展开：此时组内条目已是筛后结果，收起只会藏起匹配项
          const open = tokens.length > 0 || expanded.has(group.id);
          return (
            <section key={group.id} className="mb-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleGroup(group.id)}
                className="mb-2 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {Icon && <Icon size={14} />}
                <span>{t(group.labelKey)}</span>
                <span className="text-gray-400 dark:text-gray-500">
                  {t("workbench.itemCount", { count: group.items.length })}
                </span>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">
                  {open ? "▾" : "▸"}
                </span>
              </button>
              {open && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {group.items.map(renderCard)}
                </div>
              )}
            </section>
          );
        })}

        {tokens.length > 0 && visibleGroups.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {t("workbench.searchEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}
