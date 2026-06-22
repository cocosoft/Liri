import { useMemo } from "react";

interface SlashCommand {
  key: string;
  label: string;
  description: string;
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
        快捷命令
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
            {cmd.description}
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
    description: "打开仪表盘",
    action: () => {},
  },
  {
    key: "/files",
    label: "/files",
    description: "打开文件浏览器",
    action: () => {},
  },
  {
    key: "/knowledge",
    label: "/knowledge",
    description: "打开知识库",
    action: () => {},
  },
  {
    key: "/agent",
    label: "/agent",
    description: "打开 Agent 任务",
    action: () => {},
  },
  {
    key: "/clear",
    label: "/clear",
    description: "清空聊天消息",
    action: () => {},
  },
  {
    key: "/help",
    label: "/help",
    description: "显示可用命令",
    action: () => {},
  },
];

export type { SlashCommand };
