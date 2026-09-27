import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ShortcutEntry {
  keys: string[];
  labelKey: string;
}

const shortcuts: ShortcutEntry[] = [
  { keys: ["Ctrl", "Alt", "N"], labelKey: "common.shortcutNewSession" },
  { keys: ["Ctrl", "Shift", "N"], labelKey: "common.shortcutQuickNote" },
  { keys: ["Ctrl", "L"], labelKey: "common.shortcutClearMessages" },
  { keys: ["Ctrl", "Shift", "D"], labelKey: "common.shortcutToggleDashboard" },
  { keys: ["Ctrl", ","], labelKey: "common.shortcutOpenSettings" },
  { keys: ["Ctrl", "I"], labelKey: "common.shortcutFocusInput" },
  { keys: ["Ctrl", "/"], labelKey: "common.shortcutShowShortcuts" },
  { keys: ["Esc"], labelKey: "common.shortcutCancelFocus" },
  { keys: ["Ctrl", "Shift", "S"], labelKey: "common.shortcutStopGenerating" },
];

function KeyboardShortcutsHelp() {
  const { t } = useTranslation();
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
            {t("common.shortcuts")}
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
                {t(s.labelKey)}
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
          {t("common.pressEscToClose")}
        </p>
      </div>
    </div>
  );
}

export default KeyboardShortcutsHelp;
