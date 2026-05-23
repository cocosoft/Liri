import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput } from '../../ink';

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
}

export const InputArea: React.FC<InputAreaProps> = ({ onSubmit, disabled }) => {
  const [input, setInput] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [suggestion, setSuggestion] = useState('');
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef('');

  useEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, [disabled]);

  const addToHistory = useCallback((value: string) => {
    const hist = historyRef.current;
    if (hist.length === 0 || hist[hist.length - 1] !== value) {
      hist.push(value);
      if (hist.length > 100) hist.shift();
    }
    setHistoryIndex(-1);
    draftRef.current = '';
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !disabled) {
      addToHistory(trimmed);
      onSubmit(trimmed);
      setInput('');
      setSuggestion('');
    }
  }, [input, disabled, onSubmit, addToHistory]);

  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => {
      const hist = historyRef.current;
      if (hist.length === 0) return;

      if (direction === 'up') {
        if (historyIndex === -1) {
          draftRef.current = input;
          const newIdx = hist.length - 1;
          setHistoryIndex(newIdx);
          setInput(hist[newIdx]);
        } else if (historyIndex > 0) {
          const newIdx = historyIndex - 1;
          setHistoryIndex(newIdx);
          setInput(hist[newIdx]);
        }
      } else {
        if (historyIndex === -1) return;
        if (historyIndex < hist.length - 1) {
          const newIdx = historyIndex + 1;
          setHistoryIndex(newIdx);
          setInput(hist[newIdx]);
        } else {
          setHistoryIndex(-1);
          setInput(draftRef.current);
          draftRef.current = '';
        }
      }
      setSuggestion('');
    },
    [input, historyIndex]
  );

  const completeCommand = useCallback(() => {
    if (!input.startsWith('/')) return;
    const matching = AVAILABLE_COMMANDS.filter(
      (cmd) => cmd.startsWith(input) && cmd !== input
    );
    if (matching.length === 1) {
      setInput(matching[0] + ' ');
      setSuggestion('');
    } else if (matching.length > 1) {
      const commonPrefix = matching[0];
      let i = input.length;
      while (
        i < commonPrefix.length &&
        matching.every((c) => c[i] === commonPrefix[i])
      ) {
        i++;
      }
      const partial = commonPrefix.slice(0, i);
      if (partial !== input) {
        setInput(partial);
        setSuggestion(matching.join('  '));
      } else {
        setSuggestion(matching.join('  '));
      }
    }
  }, [input]);

  const updateSuggestion = useCallback((value: string) => {
    if (value.startsWith('/')) {
      const matching = AVAILABLE_COMMANDS.filter(
        (cmd) => cmd.startsWith(value) && cmd !== value
      );
      setSuggestion(matching.length > 0 ? matching.join('  ') : '');
    } else {
      setSuggestion('');
    }
  }, []);

  useInput(
    (_input, key) => {
      if (disabled) return;

      if (key.return) {
        handleSubmit();
        return;
      }

      if (key.upArrow) {
        navigateHistory('up');
        return;
      }

      if (key.downArrow) {
        navigateHistory('down');
        return;
      }

      if (key.tab) {
        completeCommand();
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => {
          const next = key.delete ? prev : prev.slice(0, -1);
          if (next.length <= 1 && !next.startsWith('/')) {
            setSuggestion('');
            return next || '';
          }
          updateSuggestion(next || '');
          return next || '';
        });
        setHistoryIndex(-1);
        draftRef.current = '';
        return;
      }

      if (_input.length === 1 && !key.ctrl && !key.meta) {
        setInput((prev) => {
          const next = prev + _input;
          updateSuggestion(next);
          return next;
        });
        setHistoryIndex(-1);
        draftRef.current = '';
      }
    },
    { isActive: !disabled }
  );

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
