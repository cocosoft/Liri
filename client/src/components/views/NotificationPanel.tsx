/**
 * NotificationPanel — 通知中心滑出面板
 *
 * 从右侧滑入的面板，展示分类 Tab、通知列表、操作按钮。
 */

import { useEffect, useRef } from "react";
import { useNotificationStore } from "../../stores/notificationStore";
import type {
  NotificationCategory,
  NotificationItem,
} from "../../types/notification";

// ─── 分类配置（P0-4 收件箱化：仅告知型 notice/system，决策类已移出） ───

const CATEGORIES: { key: NotificationCategory | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "system", label: "系统" },
  { key: "notice", label: "日历" },
];

// ─── 格式化 ──────────────────────────────────────────

function timeAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

function expireCountdown(expiresAt: number | null): string | null {
  if (!expiresAt) return null;
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "已过期";
  if (diff < 60) return `${diff}秒后过期`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟后过期`;
  return null;
}

function formatSource(source: string): string {
  if (!source) return "";
  if (source.startsWith("channel:")) return source.slice(8);
  if (source === "system") return "系统";
  if (source === "cron") return "定时任务";
  if (source === "inbox") return "收件箱";
  return source;
}

// ─── 优先级样式 ─────────────────────────────────────

function priorityStyles(priority: string): { bar: string; badge: string } {
  switch (priority) {
    case "urgent":
      return {
        bar: "bg-red-500",
        badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      };
    case "low":
      return {
        bar: "bg-gray-300 dark:bg-gray-600",
        badge: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
      };
    default:
      return {
        bar: "bg-blue-500",
        badge:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      };
  }
}

// ─── NotificationCard ──────────────────────────────

function NotificationCard({ item }: { item: NotificationItem }) {
  const markRead = useNotificationStore((s) => s.markRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const pStyles = priorityStyles(item.priority);
  const isExpired = item.status === "expired";
  const isResolved = item.status === "resolved";
  const countdown = expireCountdown(item.expires_at);

  return (
    <div
      className={`relative flex gap-3 p-3.5 rounded-lg transition-all cursor-pointer
        ${isExpired ? "opacity-55" : ""}
        ${item.status === "unread" ? "bg-blue-50/50 dark:bg-blue-900/10" : "bg-white dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800"}
      `}
      onClick={() => {
        if (item.status === "unread") markRead(item.id);
      }}
    >
      {/* 优先级色条 */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg ${pStyles.bar} ${item.priority === "normal" ? "opacity-0" : ""}`}
      />

      {/* 未读蓝点 */}
      {item.status === "unread" && (
        <div className="absolute left-4 top-4 w-2 h-2 rounded-full bg-blue-500" />
      )}

      <div className="flex-1 min-w-0 ml-0.5">
        {/* 头部：分类标签 + 时间 */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${pStyles.badge}`}
          >
            {CATEGORIES.find((c) => c.key === item.category)?.label ??
              item.category}
          </span>
          {item.priority === "urgent" && (
            <span className="text-[11px] text-red-500 font-medium">紧急</span>
          )}
          <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">
            {timeAgo(item.created_at)}
          </span>
        </div>

        {/* 标题 */}
        <div className="flex items-center gap-1.5">
          {isResolved && (
            <span className="text-green-500 text-xs">&#10003;</span>
          )}
          <span
            className={`text-sm font-semibold truncate ${isResolved ? "text-gray-500 dark:text-gray-400" : "text-gray-800 dark:text-gray-200"}`}
          >
            {item.title}
          </span>
        </div>

        {/* 内容摘要 */}
        {item.content && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">
            {item.content}
          </p>
        )}

        {/* 底部信息 */}
        <div className="flex items-center gap-2 mt-2">
          {isResolved && (
            <span className="text-[11px] text-green-500 font-medium">
              已处理
            </span>
          )}
          {isExpired && (
            <span className="text-[11px] text-gray-400 font-medium">
              已过期
            </span>
          )}
          {item.source && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {formatSource(item.source)}
            </span>
          )}
          {countdown && !isExpired && (
            <span className="text-[11px] text-amber-500 ml-auto">
              &#9201; {countdown}
            </span>
          )}
          {/* 删除按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(item.id);
            }}
            className="ml-auto text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
            title="删除"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EmptyState ─────────────────────────────────────

function EmptyState({ category }: { category: NotificationCategory | "all" }) {
  const label = CATEGORIES.find((c) => c.key === category)?.label ?? category;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="mb-3 opacity-40"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <p className="text-sm">
        {label === "全部" ? "暂无通知" : `暂无${label}通知`}
      </p>
    </div>
  );
}

// ─── NotificationPanel ─────────────────────────────

export default function NotificationPanel() {
  const panelOpen = useNotificationStore((s) => s.panelOpen);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const activeCategory = useNotificationStore((s) => s.activeCategory);
  const setActiveCategory = useNotificationStore((s) => s.setActiveCategory);
  const items = useNotificationStore((s) => s.items);
  const counts = useNotificationStore((s) => s.counts);
  const isLoading = useNotificationStore((s) => s.isLoading);
  const hasMore = useNotificationStore((s) => s.hasMore);
  const readAll = useNotificationStore((s) => s.readAll);
  const readingAll = useNotificationStore((s) => s.readingAll);
  const loadItems = useNotificationStore((s) => s.loadItems);

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    if (panelOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, closePanel]);

  // 滚动加载更多
  function handleScroll() {
    const el = listRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadItems();
    }
  }

  // 分类未读计数
  function catCount(key: NotificationCategory | "all"): number {
    if (key === "all") return counts.total;
    return counts[key] ?? 0;
  }

  // 过滤当前 Tab 的通知
  const filtered =
    activeCategory === "all"
      ? items
      : items.filter((i) => i.category === activeCategory);

  if (!panelOpen) return null;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={closePanel}
      />

      {/* 面板 */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 w-[420px] max-w-[100vw] bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col
          animate-[slideIn_300ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{
          animation: "slideIn 300ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            消息中心
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={readAll}
              disabled={readingAll || counts.total === 0}
              className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-40 font-medium px-2 py-1"
            >
              {readingAll ? "处理中..." : "全部已读"}
            </button>
            <button
              onClick={closePanel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* TabBar */}
        <div className="flex px-2 py-2 gap-1 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
          {CATEGORIES.map((cat) => {
            const count = catCount(cat.key);
            const isActive = cat.key === activeCategory;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-medium"
                    : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
                }`}
              >
                {cat.label}
                {count > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                      isActive
                        ? "bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300"
                        : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 列表 */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
        >
          {filtered.length === 0 && !isLoading && (
            <EmptyState category={activeCategory} />
          )}

          {filtered.map((item) => (
            <NotificationCard key={item.id} item={item} />
          ))}

          {isLoading && (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {hasMore && !isLoading && (
            <button
              onClick={() => loadItems()}
              className="w-full text-xs text-blue-500 hover:text-blue-600 py-2"
            >
              加载更多
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 text-center">
          通知保留最近 1000 条，已读 30 天后自动归档
        </div>
      </div>
    </>
  );
}
