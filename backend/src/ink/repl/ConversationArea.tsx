import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, useInput, Text } from '../../ink';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import { ToolCallPanel } from './ToolCallPanel';
import { CompanionSprite } from './CompanionSprite';
import type { DisplayMessage, ActiveToolCall, StreamState } from './types';

const CHARS_PER_LINE = 70;
const BASE_LINES_PER_MSG = 2;

interface ConversationAreaProps {
  messages: DisplayMessage[];
  streamingContent: string;
  isStreaming: boolean;
  streamState: StreamState;
  activeToolCalls: ActiveToolCall[];
  height: number;
}

function estimateMsgLines(msg: DisplayMessage): number {
  const contentLines = Math.ceil(msg.content.length / CHARS_PER_LINE);
  const toolLines = msg.toolCalls ? msg.toolCalls.length : 0;
  return BASE_LINES_PER_MSG + contentLines + toolLines;
}

export const ConversationArea: React.FC<ConversationAreaProps> = ({
  messages,
  streamingContent,
  isStreaming,
  streamState,
  activeToolCalls,
  height,
}) => {
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxVisualLines = Math.max(1, height - 3);

  const { totalLines, lineMap } = useMemo(() => {
    const map: number[] = [];
    let total = 0;
    for (let i = 0; i < messages.length; i++) {
      map.push(total);
      total += estimateMsgLines(messages[i]);
    }
    return { totalLines: total, lineMap: map };
  }, [messages]);

  useEffect(() => {
    setScrollOffset(0);
  }, [messages.length]);

  const handleScrollUp = useCallback(() => {
    setScrollOffset((prev) => {
      const maxOffset = Math.max(0, totalLines - maxVisualLines);
      return Math.min(maxOffset, prev + Math.ceil(maxVisualLines / 2));
    });
  }, [totalLines, maxVisualLines]);

  const handleScrollDown = useCallback(() => {
    setScrollOffset((prev) =>
      Math.max(0, prev - Math.ceil(maxVisualLines / 2))
    );
  }, [maxVisualLines]);

  const handleScrollHome = useCallback(() => {
    const maxOffset = Math.max(0, totalLines - maxVisualLines);
    setScrollOffset(maxOffset);
  }, [totalLines, maxVisualLines]);

  const handleScrollEnd = useCallback(() => {
    setScrollOffset(0);
  }, []);

  useInput((_input, key) => {
    if (key.pageUp) {
      handleScrollUp();
      return;
    }
    if (key.pageDown) {
      handleScrollDown();
      return;
    }
    if (key.ctrl && key.home) {
      handleScrollHome();
      return;
    }
    if (key.ctrl && key.end) {
      handleScrollEnd();
      return;
    }
  });

  const visibleMessages = useMemo(() => {
    if (messages.length === 0) return [];
    let startIdx = messages.length - 1;
    let cumulative = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      cumulative += estimateMsgLines(messages[i]);
      if (cumulative > scrollOffset + maxVisualLines) {
        startIdx = i + 1;
        break;
      }
      if (cumulative >= scrollOffset) {
        startIdx = Math.max(0, i);
      }
    }
    const result: DisplayMessage[] = [];
    for (let i = startIdx; i < messages.length; i++) {
      result.push(messages[i]);
    }
    return result;
  }, [messages, scrollOffset, maxVisualLines]);

  const isScrolledUp = scrollOffset > 0;

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {isScrolledUp && (
        <Box paddingX={2}>
          <Text color="gray" dimColor>
            -- 已滚动 ({scrollOffset} 行在上方, PageDown/PageUp 翻页, Ctrl+End
            回到最新) --
          </Text>
        </Box>
      )}
      {visibleMessages.map((msg) => (
        <React.Fragment key={msg.id}>
          <MessageBubble message={msg} />
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <ToolCallPanel
              activeToolCalls={[]}
              completedToolCalls={msg.toolCalls}
            />
          )}
        </React.Fragment>
      ))}
      {isStreaming && (
        <CompanionSprite
          streamState={streamState}
          hasContent={streamingContent.length > 0}
          hasToolCalls={activeToolCalls.length > 0}
        />
      )}
      {isStreaming && activeToolCalls.length > 0 && (
        <ToolCallPanel activeToolCalls={activeToolCalls} />
      )}
      {isStreaming && streamingContent && (
        <StreamingMessage content={streamingContent} />
      )}
      {messages.length === 0 && !isStreaming && (
        <Box paddingX={2} paddingY={1}>
          <MessageBubble
            message={{
              id: 'welcome',
              role: 'system',
              content:
                'PY_APP REPL (Ink 模式) — 输入消息开始对话，输入 /help 查看命令，输入 exit 退出。',
              timestamp: Date.now(),
            }}
          />
        </Box>
      )}
    </Box>
  );
};
