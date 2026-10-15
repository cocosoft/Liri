import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from 'react';
import { Box, Text } from '../../ink';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ink:repl:InputArea');

/** 静态兜底（注册表不可用时的列表；也是 ink 本地命令的来源之一） */
const AVAILABLE_COMMANDS = [
  '/help',
  '/onboard',
  '/clear',
  '/router',
  '/exit',
  '/quit',
  '/ink',
];

/**
 * 提示行最多列出的命令数。
 * ⚠️ 注册表有 131 条（2026-10-16 实测）：不设上限时，输入一个 `/` 会把单行 `<Text>`
 * 提示撑成二十来行，直接吃掉 ConversationArea 的高度预算（`terminalHeight - 9`）。
 */
const SUGGESTION_LIMIT = 12;

/** 提示行文案：超出上限则折叠为计数（提示继续输入以缩小范围） */
function formatSuggestion(matching: string[]): string {
  if (matching.length === 0) return '';
  const head = matching.slice(0, SUGGESTION_LIMIT).join('  ');
  return matching.length > SUGGESTION_LIMIT
    ? `${head}  …（共 ${matching.length} 个，继续输入缩小范围）`
    : head;
}

interface InputAreaProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  onEscape?: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({
  onSubmit,
  disabled,
  onEscape,
}) => {
  const [input, setInput] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState('');
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');
  /** 补全/提示的来源列表（静态兜底 ∪ 注册表，注册表就绪后在 effect 里合并） */
  const commandsRef = useRef<string[]>(AVAILABLE_COMMANDS);

  const onSubmitRef = useRef(onSubmit);
  const onEscapeRef = useRef(onEscape);
  const disabledRef = useRef(disabled);
  const setInputRef = useRef(setInput);
  const setSuggestionRef = useRef(setSuggestion);
  const setHistoryIndexRef = useRef(setHistoryIndex);

  useLayoutEffect(() => {
    onSubmitRef.current = onSubmit;
    onEscapeRef.current = onEscape;
    disabledRef.current = disabled;
    setInputRef.current = setInput;
    setSuggestionRef.current = setSuggestion;
    setHistoryIndexRef.current = setHistoryIndex;
  });

  useLayoutEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, [disabled]);

  // ②（2026-10-16）：补全来源接**真实命令注册表**（与派发同源），否则内置命令
  // （/budget、/git…）在 TUI 里既不可见也无法 Tab 补全。合并进 ref（stdin 监听器
  // 只注册一次，读 state 会拿到闭包旧值 ⇒ 必须走 ref）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { commandRegistry } = await import('@modules/commands');
        const names = commandRegistry.getVisible().map((cmd) => `/${cmd.name}`);
        if (cancelled || names.length === 0) return;
        commandsRef.current = [
          ...new Set([...AVAILABLE_COMMANDS, ...names]),
        ].sort();
      } catch (error) {
        // 注册表不可用（尚未 initializeCommands）⇒ 保留静态列表，并留日志（不静默）
        logger.warn('命令补全来源加载失败，回退静态列表', {
          error: error instanceof Error ? error.message : String(error),
          fallbackCount: AVAILABLE_COMMANDS.length,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (disabled) return;

    const stdin = process.stdin;
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let escapeSequence = '';

    const handleData = (data: Buffer) => {
      const str = data.toString('utf-8');

      for (const char of str) {
        if (char === '\x1b') {
          escapeSequence = '\x1b';
          continue;
        }

        if (escapeSequence) {
          escapeSequence += char;

          if (escapeSequence === '\x1b[A') {
            setHistoryIndexRef.current((prev) => {
              const hist = historyRef.current;
              if (hist.length === 0) return prev;
              if (prev === -1) {
                draftRef.current = input;
                return hist.length - 1;
              } else if (prev > 0) {
                return prev - 1;
              }
              return prev;
            });
            setInputRef.current((prev) => {
              const hist = historyRef.current;
              if (historyIndex === -1) {
                return hist[hist.length - 1] || prev;
              } else if (historyIndex > 0) {
                return hist[historyIndex - 1] || prev;
              }
              return prev;
            });
            setSuggestionRef.current('');
            escapeSequence = '';
            continue;
          }

          if (escapeSequence === '\x1b[B') {
            setHistoryIndexRef.current((prev) => {
              const hist = historyRef.current;
              if (prev === -1) return prev;
              if (prev < hist.length - 1) {
                return prev + 1;
              }
              draftRef.current = '';
              return -1;
            });
            setInputRef.current((prev) => {
              const hist = historyRef.current;
              if (historyIndex < hist.length - 1) {
                return hist[historyIndex + 1] || prev;
              }
              return draftRef.current || prev;
            });
            setSuggestionRef.current('');
            escapeSequence = '';
            continue;
          }

          escapeSequence = '';
          continue;
        }

        if (char === '\r' || char === '\n') {
          setInputRef.current((currentInput) => {
            const trimmed = currentInput.trim();
            if (trimmed && !disabledRef.current) {
              const hist = historyRef.current;
              if (hist.length === 0 || hist[hist.length - 1] !== trimmed) {
                hist.push(trimmed);
                if (hist.length > 100) hist.shift();
              }
              setHistoryIndexRef.current(-1);
              draftRef.current = '';
              onSubmitRef.current(trimmed);
              setSuggestionRef.current('');
              return '';
            }
            return currentInput;
          });
          continue;
        }

        if (char === '\x7f' || char === '\x08') {
          setInputRef.current((prev) => {
            const next = prev.slice(0, -1);
            if (next.length <= 1 && !next.startsWith('/')) {
              setSuggestionRef.current('');
              return next || '';
            }
            if (next.startsWith('/')) {
              const matching = commandsRef.current.filter(
                (cmd) => cmd.startsWith(next) && cmd !== next
              );
              setSuggestionRef.current(formatSuggestion(matching));
            } else {
              setSuggestionRef.current('');
            }
            return next || '';
          });
          setHistoryIndexRef.current(-1);
          draftRef.current = '';
          continue;
        }

        if (char === '\t') {
          setInputRef.current((currentInput) => {
            if (!currentInput.startsWith('/')) return currentInput;
            const matching = commandsRef.current.filter(
              (cmd) => cmd.startsWith(currentInput) && cmd !== currentInput
            );
            if (matching.length === 1) {
              setSuggestionRef.current('');
              return matching[0] + ' ';
            } else if (matching.length > 1) {
              const commonPrefix = matching[0];
              let i = currentInput.length;
              while (
                i < commonPrefix.length &&
                matching.every((c) => c[i] === commonPrefix[i])
              ) {
                i++;
              }
              const partial = commonPrefix.slice(0, i);
              if (partial !== currentInput) {
                setSuggestionRef.current(formatSuggestion(matching));
                return partial;
              }
              setSuggestionRef.current(formatSuggestion(matching));
            }
            return currentInput;
          });
          continue;
        }

        if (char === '\x1b') {
          onEscapeRef.current?.();
          continue;
        }

        if (char.length === 1 && char >= ' ') {
          setInputRef.current((prev) => {
            const next = prev + char;
            if (next.startsWith('/')) {
              const matching = commandsRef.current.filter(
                (cmd) => cmd.startsWith(next) && cmd !== next
              );
              setSuggestionRef.current(formatSuggestion(matching));
            } else {
              setSuggestionRef.current('');
            }
            return next;
          });
          setHistoryIndexRef.current(-1);
          draftRef.current = '';
        }
      }
    };

    stdin.on('data', handleData);

    return () => {
      stdin.removeListener('data', handleData);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
    };
  }, [disabled]);

  const displayText = input + (cursorVisible && !disabled ? '▊' : '');

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row">
        <Text color="cyan" bold>
          {'> '}
        </Text>
        <Text>{displayText || ' '}</Text>
      </Box>
      {suggestion.length > 0 && (
        <Box paddingLeft={2}>
          <Text color="gray">{suggestion}</Text>
        </Box>
      )}
    </Box>
  );
};
