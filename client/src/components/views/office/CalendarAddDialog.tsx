/**
 * CalendarAddDialog — 添加/编辑日程的模态弹窗
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { EventStatus } from "../../../types/office";

export interface CalendarAddFormData {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  status?: EventStatus;
  priority?: number;
  tags?: string;
}

interface CalendarAddDialogProps {
  open: boolean;
  onClose: () => void;
  /** 预填的默认日期（YYYY-MM-DD） */
  defaultDate?: string;
  /** 编辑模式下的现有数据 */
  initialData?: Partial<CalendarAddFormData>;
  onSave: (data: CalendarAddFormData) => Promise<void>;
}

export default function CalendarAddDialog({
  open,
  onClose,
  defaultDate,
  initialData,
  onSave,
}: CalendarAddDialogProps) {
  const [summary, setSummary] = useState(initialData?.summary ?? "");
  const [start, setStart] = useState(
    initialData?.start ?? (defaultDate ? `${defaultDate}T09:00` : ""),
  );
  const [end, setEnd] = useState(
    initialData?.end ?? (defaultDate ? `${defaultDate}T10:00` : ""),
  );
  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );
  const [location, setLocation] = useState(initialData?.location ?? "");
  const [status, setStatus] = useState<EventStatus>(
    initialData?.status ?? "pending",
  );
  const [priority, setPriority] = useState(initialData?.priority ?? 3);
  const [tags, setTags] = useState(initialData?.tags ?? "");
  const [saving, setSaving] = useState(false);

  // 重置表单
  const reset = () => {
    setSummary(initialData?.summary ?? "");
    setStart(initialData?.start ?? (defaultDate ? `${defaultDate}T09:00` : ""));
    setEnd(initialData?.end ?? (defaultDate ? `${defaultDate}T10:00` : ""));
    setDescription(initialData?.description ?? "");
    setLocation(initialData?.location ?? "");
    setStatus(initialData?.status ?? "pending");
    setPriority(initialData?.priority ?? 3);
    setTags(initialData?.tags ?? "");
  };

  const handleSave = async () => {
    if (!summary || !start) return;
    setSaving(true);
    try {
      await onSave({
        summary,
        start: new Date(start).toISOString(),
        end: end ? new Date(end).toISOString() : new Date(start).toISOString(),
        description: description || undefined,
        location: location || undefined,
        status,
        priority,
        tags: tags || undefined,
      });
      onClose();
      reset();
    } finally {
      setSaving(false);
    }
  };

  const priorityStars = [1, 2, 3, 4, 5];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {initialData?.summary ? "编辑日程" : "添加日程"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* 标题 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              标题 *
            </label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="日程标题"
              autoFocus
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          {/* 时间 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                开始时间
              </label>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                结束时间
              </label>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述（可选）"
              rows={2}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white resize-none"
            />
          </div>
          {/* 地点 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              地点
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="地点（可选）"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          {/* 状态 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              状态
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as EventStatus)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="pending">待办</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
          {/* 优先级 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              优先级
            </label>
            <div className="flex gap-1">
              {priorityStars.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`text-lg leading-none transition-colors ${
                    p <= priority
                      ? "text-yellow-500"
                      : "text-gray-300 dark:text-gray-600"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          {/* 标签 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              标签
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="标签，逗号分隔（可选）"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !summary}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
