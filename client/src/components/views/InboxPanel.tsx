import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  Check,
  X,
  Clock,
  AlertCircle,
  Shield,
  HelpCircle,
} from "lucide-react";
import { inboxService } from "../../services/inboxService";
import type { InboxItem, InboxItemStatus } from "../../types";
import { getChannelLabel } from "../../types";

const TYPE_ICONS: Record<InboxItem["type"], typeof Mail> = {
  approval: Shield,
  question: HelpCircle,
  authorization: AlertCircle,
};

const TYPE_LABELS: Record<InboxItem["type"], string> = {
  approval: "审批",
  question: "提问",
  authorization: "授权",
};

const STATUS_COLORS: Record<InboxItemStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  replied:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  expired: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  dismissed: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_LABELS: Record<InboxItemStatus, string> = {
  pending: "待处理",
  replied: "已回复",
  expired: "已过期",
  dismissed: "已忽略",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function InboxPanel() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InboxItemStatus | "">("");
  const [replyText, setReplyText] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const status = filter || undefined;
      const result = await inboxService.list({
        status: status as InboxItemStatus | undefined,
        limit: 50,
      });
      setItems(result.items);
    } catch {
      // 后端未就绪时静默
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function handleReply(id: string) {
    if (!replyText.trim()) return;
    try {
      await inboxService.reply(id, replyText);
      setReplyText("");
      setReplyingId(null);
      load();
    } catch {
      // ignore
    }
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const isDark = document.documentElement.classList.contains("dark");

  return (
    <div
      className={`flex flex-col h-full ${isDark ? "bg-gray-900" : "bg-gray-50"}`}
    >
      {/* 标题栏 */}
      <div
        className={`flex items-center justify-between px-6 py-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
      >
        <div className="flex items-center gap-2">
          <Mail
            size={18}
            className={isDark ? "text-gray-400" : "text-gray-500"}
          />
          <h2
            className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
          >
            Inbox
          </h2>
          {pendingCount > 0 && (
            <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
              {pendingCount}
            </span>
          )}
        </div>

        {/* 状态过滤 */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as InboxItemStatus | "")}
          className={`text-xs rounded px-2 py-1 border ${isDark ? "bg-gray-800 border-gray-700 text-gray-300" : "bg-white border-gray-200 text-gray-700"}`}
        >
          <option value="">全部</option>
          <option value="pending">待处理</option>
          <option value="replied">已回复</option>
          <option value="expired">已过期</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <Mail size={32} />
            <p className="text-sm">暂无待处理事项</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((item) => {
              const Icon = TYPE_ICONS[item.type] ?? Mail;
              return (
                <div
                  key={item.id}
                  className={`px-6 py-4 ${item.status === "pending" ? (isDark ? "bg-gray-800/50" : "bg-white") : "opacity-60"}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      size={18}
                      className={`mt-0.5 flex-shrink-0 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[item.status]}`}
                        >
                          {STATUS_LABELS[item.status]}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}
                        >
                          {TYPE_LABELS[item.type]}
                        </span>
                        {item.source && item.source !== "" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                            {item.source}
                          </span>
                        )}
                        {item.channelId && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400"
                            title={`来源渠道: ${getChannelLabel(item.channelId)}`}
                          >
                            💬 {getChannelLabel(item.channelId)}
                          </span>
                        )}
                        <span
                          className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                        >
                          {timeAgo(item.createdAt)}
                        </span>
                      </div>
                      <h3
                        className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}
                      >
                        {item.title}
                      </h3>
                      <p
                        className={`text-xs whitespace-pre-wrap ${isDark ? "text-gray-400" : "text-gray-600"}`}
                      >
                        {item.message}
                      </p>

                      {/* 回复区域 */}
                      {item.status === "pending" && replyingId === item.id && (
                        <div className="mt-3 flex gap-2">
                          <input
                            type="text"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="输入回复..."
                            className={`flex-1 text-xs rounded px-2 py-1 border ${isDark ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleReply(item.id);
                              if (e.key === "Escape") {
                                setReplyingId(null);
                                setReplyText("");
                              }
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleReply(item.id)}
                            className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setReplyingId(null);
                              setReplyText("");
                            }}
                            className="p-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      {/* 已回复内容 */}
                      {item.reply && (
                        <div
                          className={`mt-2 text-xs px-2 py-1 rounded ${isDark ? "bg-blue-900/20 text-blue-300" : "bg-blue-50 text-blue-700"}`}
                        >
                          → {item.reply}
                        </div>
                      )}

                      {/* 操作按钮 */}
                      {item.status === "pending" && replyingId !== item.id && (
                        <div className="mt-2 flex gap-2">
                          {item.options ? (
                            item.options.map((opt) => (
                              <button
                                key={opt}
                                onClick={() =>
                                  inboxService
                                    .reply(item.id, opt, opt)
                                    .then(load)
                                }
                                className={`text-xs px-2 py-1 rounded ${isDark ? "bg-gray-700 text-gray-300 hover:bg-gray-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                              >
                                {opt}
                              </button>
                            ))
                          ) : (
                            <button
                              onClick={() => setReplyingId(item.id)}
                              className={`text-xs px-2 py-1 rounded ${isDark ? "bg-blue-900/30 text-blue-300 hover:bg-blue-900/50" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
                            >
                              回复
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {item.status === "pending" && (
                      <Clock
                        size={14}
                        className={`mt-0.5 flex-shrink-0 ${isDark ? "text-amber-400" : "text-amber-500"}`}
                      />
                    )}
                    {item.status === "replied" && (
                      <Check
                        size={14}
                        className={`mt-0.5 flex-shrink-0 ${isDark ? "text-green-400" : "text-green-500"}`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default InboxPanel;
