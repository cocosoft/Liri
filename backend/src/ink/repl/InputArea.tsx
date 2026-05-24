import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Box, Text } from '../../ink';

const AVAILABLE_COMMANDS = [
  '/help',
  '/onboard',
  '/clear',
  '/exit',
  '/quit',
  '/ink',
];

interface InputAreaProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  onEscape?: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSubmit, disabled, onEscape }) => {
  const [input, setInput] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState('');
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');

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
              const matching = AVAILABLE_COMMANDS.filter(
                (cmd) => cmd.startsWith(next) && cmd !== next
              );
              setSuggestionRef.current(matching.length > 0 ? matching.join('  ') : '');
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
            const matching = AVAILABLE_COMMANDS.filter(
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
                setSuggestionRef.current(matching.join('  '));
                return partial;
              }
              setSuggestionRef.current(matching.join('  '));
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
              const matching = AVAILABLE_COMMANDS.filter(
                (cmd) => cmd.startsWith(next) && cmd !== next
              );
              setSuggestionRef.current(matching.length > 0 ? matching.join('  ') : '');
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