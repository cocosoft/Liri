import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { httpLegacy as http } from "../../services/httpClient";
import { handleClientError } from "../../utils/handleError";

interface KanbanCard {
  id: string;
  title: string;
  description: string;
  columnId: string;
  assignee?: string;
  priority: string;
  tags: string[];
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

const COLUMNS = [
  {
    id: "backlog",
    label: "agent.backlog",
    icon: "📥",
    color: "bg-gray-200 dark:bg-gray-700",
  },
  {
    id: "todo",
    label: "agent.todo",
    icon: "📋",
    color: "bg-yellow-100 dark:bg-yellow-900/30",
  },
  {
    id: "in_progress",
    label: "agent.in_progress",
    icon: "🔄",
    color: "bg-blue-100 dark:bg-blue-900/30",
  },
  {
    id: "done",
    label: "agent.done",
    icon: "✅",
    color: "bg-green-100 dark:bg-green-900/30",
  },
];

const PRI: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-gray-400",
};

export default function KanbanBoard() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [pri, setPri] = useState("medium");
  const [dragOverCol, setDragOverCol] = useState("");
  const [dragging, setDragging] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get<KanbanCard[]>("/v1/kanban");
      if (Array.isArray(res)) setCards(res);
    } catch (e) {
      handleClientError(e, { module: "components:agent:KanbanBoard", action: "load" });
      /* */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      await http.post("/v1/kanban", {
        title: t,
        description: desc.trim(),
        priority: pri,
      });
      setTitle("");
      setDesc("");
      setShowCreate(false);
      load();
    } catch (e) {
      handleClientError(e, { module: "components:agent:KanbanBoard", action: "create" });
      /* */
    }
  };

  const del = async (id: string) => {
    try {
      await http.delete(`/v1/kanban/${id}`);
      load();
    } catch (e) {
      handleClientError(e, { module: "components:agent:KanbanBoard", action: "del" });
      /* */
    }
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("cardId", id);
    setDragging(id);
  };

  const onDragEnd = () => {
    setDragging("");
    setDragOverCol("");
  };

  const onDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverCol(colId);
  };

  const onDrop = async (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("cardId");
    if (!cardId) return;
    try {
      await http.put(`/v1/kanban/${cardId}/move`, {
        columnId: colId,
        sortOrder: Date.now(),
      });
      load();
    } catch (e) {
      handleClientError(e, { module: "components:agent:KanbanBoard", action: "onDrop" });
      /* */
    }
    setDragOverCol("");
    setDragging("");
  };

  const colCards = (colId: string) => cards.filter((c) => c.columnId === colId);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Kanban ({cards.length})
        </span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800"
        >
          {showCreate ? "收起" : "+ 新建"}
        </button>
      </div>

      {showCreate && (
        <div className="space-y-1.5 bg-gray-50 dark:bg-gray-700/30 p-2 rounded border border-gray-200 dark:border-gray-700">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("agent.kanban")}
            className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t("workspace.detail")}
            className="w-full px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <div className="flex items-center gap-2">
            <select
              value={pri}
              onChange={(e) => setPri(e.target.value)}
              className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700"
            >
              <option value="high">{t("workspace.priority")}</option>
              <option value="medium">{t("agent.status")}</option>
              <option value="low">{t("common.close")}</option>
            </select>
            <button
              onClick={create}
              disabled={!title.trim()}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 max-h-[320px] overflow-y-auto">
        {COLUMNS.map((col) => {
          const items = colCards(col.id);
          return (
            <div
              key={col.id}
              className={`flex-1 min-w-[100px] rounded p-1.5 ${col.color} ${dragOverCol === col.id ? "ring-2 ring-blue-400" : ""}`}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <div className="text-[10px] font-medium text-gray-600 dark:text-gray-300 mb-1 flex items-center justify-between">
                <span>
                  {col.icon} {t(col.label)}
                </span>
                <span className="text-gray-400">{items.length}</span>
              </div>
              <div className="space-y-1">
                {items.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, card.id)}
                    onDragEnd={onDragEnd}
                    className={`bg-white dark:bg-gray-800 rounded p-1.5 shadow-sm border-l-2 ${PRI[card.priority] || ""} cursor-grab active:cursor-grabbing ${dragging === card.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                        {card.title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          del(card.id);
                        }}
                        className="text-gray-400 hover:text-red-500 text-[10px] ml-1 shrink-0"
                      >
                        ×
                      </button>
                    </div>
                    {card.description && (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                        {card.description}
                      </p>
                    )}
                    {card.assignee && (
                      <span className="text-[9px] text-blue-500 mt-0.5 block">
                        👤 {card.assignee}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
