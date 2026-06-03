import { useEffect, useState } from "react";

interface ShortcutEntry {
  keys: string[];
  label: string;
}

const shortcuts: ShortcutEntry[] = [
  { keys: ["Ctrl", "Shift", "N"], label: "新建会话" },
  { keys: ["Ctrl", "L"], label: "清空当前消息" },
  { keys: ["Ctrl", "Shift", "D"], label: "切换仪表盘" },
  { keys: ["Ctrl", ","], label: "打开设置面板" },
  { keys: ["Ctrl", "I"], label: "聚焦输入框" },
  { keys: ["Ctrl", "/"], label: "显示快捷键帮助" },
  { keys: ["Esc"], label: "取消聚焦 / 关闭弹窗" },
];

function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener("toggle-shortcut-help", handler);
    return () => window.removeEventListener("toggle-shortcut-help", handler);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            快捷键
          </h3>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {s.label}
              </span>
              <div className="flex gap-1">
                {s.keys.map((key, j) => (
                  <span
                    key={j}
                    className="px-2 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600"
                  >
                    {key}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 text-center">
          按 Esc 关闭
        </p>
      </div>
    </div>
  );
}

export default KeyboardShortcutsHelp;
