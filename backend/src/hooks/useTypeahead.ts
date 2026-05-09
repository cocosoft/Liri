/**
 * 自动补全Hook
 * 基于CC源码 cc_code/backend/hooks/useTypeahead.tsx 实现
 *
 * 支持：
 * - 命令补全
 * - 文件补全
 * - 参数补全
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

/**
 * 补全项类型
 */
export interface CompletionItem {
  /** 补全文本 */
  text: string;
  /** 显示文本 */
  displayText?: string;
  /** 描述 */
  description?: string;
  /** 类型（命令、文件、参数等） */
  type: 'command' | 'file' | 'parameter' | 'variable' | 'keyword';
  /** 图标 */
  icon?: string;
  /** 是否为部分匹配 */
  isPartial?: boolean;
  /** 优先级 */
  priority?: number;
}

/**
 * 补全结果
 */
export interface CompletionResult {
  /** 补全项列表 */
  items: CompletionItem[];
  /** 匹配的前缀长度 */
  matchLength: number;
  /** 是否有更多结果 */
  hasMore?: boolean;
}

/**
 * useTypeahead Hook结果
 */
export interface UseTypeaheadResult {
  /** 当前输入值 */
  value: string;
  /** 当前补全结果 */
  completions: CompletionItem[];
  /** 是否显示补全 */
  isOpen: boolean;
  /** 当前选中的索引 */
  selectedIndex: number;
  /** 输入变化处理 */
  onChange: (value: string) => void;
  /** 选择补全项 */
  select: (item: CompletionItem) => void;
  /** 选择下一项 */
  selectNext: () => void;
  /** 选择上一项 */
  selectPrevious: () => void;
  /** 关闭补全 */
  close: () => void;
  /** 切换补全显示 */
  toggle: () => void;
}

/**
 * 补全数据源接口
 */
export interface CompletionSource {
  /** 数据源名称 */
  name: string;
  /** 获取补全项 */
  getCompletions: (query: string) => Promise<CompletionItem[]>;
  /** 优先级 */
  priority?: number;
}

/**
 * 默认命令补全源
 */
const defaultCommands: CompletionItem[] = [
  {
    text: 'ls',
    displayText: 'ls',
    description: '列出目录内容',
    type: 'command',
    icon: '📁',
  },
  {
    text: 'cd',
    displayText: 'cd',
    description: '切换目录',
    type: 'command',
    icon: '📂',
  },
  {
    text: 'cat',
    displayText: 'cat',
    description: '查看文件内容',
    type: 'command',
    icon: '📄',
  },
  {
    text: 'grep',
    displayText: 'grep',
    description: '搜索文本',
    type: 'command',
    icon: '🔍',
  },
  {
    text: 'git',
    displayText: 'git',
    description: 'Git命令',
    type: 'command',
    icon: '📦',
  },
  {
    text: 'help',
    displayText: 'help',
    description: '显示帮助',
    type: 'command',
    icon: '❓',
  },
  {
    text: 'clear',
    displayText: 'clear',
    description: '清屏',
    type: 'command',
    icon: '🧹',
  },
  {
    text: 'exit',
    displayText: 'exit',
    description: '退出',
    type: 'command',
    icon: '🚪',
  },
];

/**
 * useTypeahead Hook
 * @param sources 自定义补全数据源
 * @param options 配置选项
 * @returns 自动补全状态和操作方法
 */
export function useTypeahead(
  sources: CompletionSource[] = [],
  options: {
    minLength?: number;
    maxResults?: number;
    debounceMs?: number;
    enableFileCompletion?: boolean;
  } = {}
): UseTypeaheadResult {
  const {
    minLength = 1,
    maxResults = 10,
    debounceMs = 150,
    enableFileCompletion = true,
  } = options;

  const [value, setValue] = useState('');
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 合并所有补全源并过滤排序
  const getCompletions = useCallback(
    async (query: string): Promise<CompletionItem[]> => {
      if (query.length < minLength) return [];

      const results: CompletionItem[] = [];

      // 添加默认命令
      const commandMatches = defaultCommands.filter((cmd) =>
        cmd.text.toLowerCase().startsWith(query.toLowerCase())
      );
      results.push(
        ...commandMatches.map((cmd) => ({
          ...cmd,
          priority: cmd.priority || 100,
        }))
      );

      // 添加自定义数据源
      for (const source of sources) {
        try {
          const items = await source.getCompletions(query);
          results.push(
            ...items.map((item) => ({
              ...item,
              priority: item.priority || source.priority || 50,
            }))
          );
        } catch (error) {
          console.warn(`加载补全源 ${source.name} 失败:`, error);
        }
      }

      // 过滤和排序
      return results
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, maxResults);
    },
    [minLength, maxResults, sources]
  );

  // 处理输入变化
  const onChange = useCallback(
    (newValue: string) => {
      setValue(newValue);
      setSelectedIndex(0);

      // 清除之前的防抖
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // 防抖获取补全
      debounceRef.current = setTimeout(async () => {
        const results = await getCompletions(newValue);
        setCompletions(results);
        setIsOpen(results.length > 0);
      }, debounceMs);
    },
    [getCompletions, debounceMs]
  );

  // 清理防抖
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // 选择补全项
  const select = useCallback((item: CompletionItem) => {
    setValue(item.text);
    setCompletions([]);
    setIsOpen(false);
  }, []);

  // 选择下一项
  const selectNext = useCallback(() => {
    setSelectedIndex((prev) => (prev < completions.length - 1 ? prev + 1 : 0));
  }, [completions.length]);

  // 选择上一项
  const selectPrevious = useCallback(() => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : completions.length - 1));
  }, [completions.length]);

  // 关闭补全
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // 切换补全显示
  const toggle = useCallback(() => {
    if (completions.length > 0) {
      setIsOpen((prev) => !prev);
    }
  }, [completions.length]);

  return {
    value,
    completions,
    isOpen,
    selectedIndex,
    onChange,
    select,
    selectNext,
    selectPrevious,
    close,
    toggle,
  };
}

/**
 * 简化版useTypeahead，用于命令行自动补全
 */
export function useCommandCompletion(
  commands: string[] = [],
  options: { minLength?: number; maxResults?: number } = {}
): UseTypeaheadResult {
  const commandSource: CompletionSource = {
    name: 'commands',
    getCompletions: async (query) => {
      return commands
        .filter((cmd) => cmd.toLowerCase().startsWith(query.toLowerCase()))
        .map((cmd) => ({
          text: cmd,
          displayText: cmd,
          type: 'command' as const,
        }));
    },
    priority: 100,
  };

  return useTypeahead([commandSource], options);
}
