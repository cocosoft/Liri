import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface SlashCommand {
  key: string;
  label: string;
  /** i18n key（N-19 处置：原为硬编码中文描述，英文 locale 下会显示中文） */
  descriptionKey: string;
  action: () => void;
}

interface SlashCommandMenuProps {
  /** 当前输入值 */
  input: string;
  /** 是否显示命令菜单 */
  show: boolean;
  /** 当前选中项索引 */
  commandIndex: number;
  /** 选中命令 */
  onSelect: (cmd: SlashCommand) => void;
  /** 悬停命令 */
  onHover: (index: number) => void;
}

/**
 * SlashCommandMenu — 快捷命令菜单组件
 *
 * 在输入框上方展示 /command 匹配列表，支持键盘上下选择。
 * 不包含命令配置本身，命令由父组件通过 onSelect 回调消费。
 */
export default function SlashCommandMenu({
  input,
  show,
  commandIndex,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  const { t } = useTranslation();
  const filteredCommands = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    return SLASH_COMMANDS.filter((cmd) =>
      cmd.key.startsWith(input.toLowerCase()),
    );
  }, [input]);

  if (!show || filteredCommands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl overflow-hidden">
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
        {t("slashCommands.title")}
      </div>
      {filteredCommands.map((cmd, idx) => (
        <button
          key={cmd.key}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHover(idx)}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
            idx === commandIndex
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
          }`}
        >
          <span className="font-mono text-blue-600 dark:text-blue-400 font-medium">
            {cmd.label}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {t(cmd.descriptionKey)}
          </span>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// 快捷命令配置（集中管理，可扩展为后端配置）
// ============================================================

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    key: "/dashboard",
    label: "/dashboard",
    descriptionKey: "slashCommands.dashboard",
    action: () => {},
  },
  {
    key: "/files",
    label: "/files",
    descriptionKey: "slashCommands.files",
    action: () => {},
  },
  {
    key: "/knowledge",
    label: "/knowledge",
    descriptionKey: "slashCommands.knowledge",
    action: () => {},
  },
  {
    key: "/agent",
    label: "/agent",
    descriptionKey: "slashCommands.agent",
    action: () => {},
  },
  {
    key: "/translate",
    label: "/translate",
    descriptionKey: "slashCommands.translate",
    action: () => {},
  },
  {
    key: "/clear",
    label: "/clear",
    descriptionKey: "slashCommands.clear",
    action: () => {},
  },
  {
    key: "/help",
    label: "/help",
    descriptionKey: "slashCommands.help",
    action: () => {},
  },
  // §4.2-4（方案 B）：把已有的全局搜索（Ctrl+K 弹窗）接到 Composer——
  // `/search <关键词>` → 打开弹窗并预填关键词；不带关键词时仅打开弹窗。
  {
    key: "/search",
    label: "/search",
    descriptionKey: "slashCommands.search",
    action: () => {},
  },
];

export type { SlashCommand };
