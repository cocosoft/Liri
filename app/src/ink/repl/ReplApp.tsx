import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, AlternateScreen, useApp } from '../../ink';
import { ConversationArea } from './ConversationArea';
import { InputArea } from './InputArea';
import { StatusBar } from './StatusBar';
import { Header } from './Header';
import { Logger } from '@modules/monitoring/logs/Logger';
import type {
  DisplayMessage,
  StreamStats,
  StreamState,
  ToolCallInfo,
  ActiveToolCall,
} from './types';
import type { ChatManager } from '@modules/chat/ChatManager';

const logger = new Logger({ level: 'info' as never });

const STREAM_PAUSE_THRESHOLD_MS = 1500;

interface ReplAppProps {
  chatManager: ChatManager;
  onExit: () => void;
}

export const ReplApp: React.FC<ReplAppProps> = ({ chatManager, onExit }) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
  const [terminalHeight, setTerminalHeight] = useState(24);
  const [submitCount, setSubmitCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const pauseResolveRef = useRef<(() => void) | null>(null);
  const isPausedRef = useRef(false);

  const { exit } = useApp();

  const handleEscape = useCallback(() => {
    if (streamState === 'streaming') {
      isPausedRef.current = true;
      setStreamState('paused');
    } else if (streamState === 'paused') {
      isPausedRef.current = false;
      setStreamState('streaming');
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
    }
  }, [streamState]);

  useEffect(() => {
    const updateHeight = () => {
      const h = process.stdout.rows || 24;
      setTerminalHeight(h);
    };
    updateHeight();
    process.stdout.on('resize', updateHeight);
    return () => {
      process.stdout.removeListener('resize', updateHeight);
    };
  }, []);

  const handleSubmit = useCallback(
    async (content: string) => {
      setSubmitCount((prev) => prev + 1);
      logger.info('handleSubmit 开始', { content });

      if (content === 'exit' || content === 'quit') {
        exit?.();
        onExit();
        return;
      }

      if (content === '/clear') {
        setMessages([]);
        return;
      }

      if (content === '/help') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
          {
            id: `help-${Date.now()}`,
            role: 'system',
            content: [
              '可用命令:',
              '  /help    - 显示帮助',
              '  /clear   - 清空对话',
              '  /onboard - 重新配置 AI 设置',
              '  /ink     - 显示 Ink 模式信息',
              '  exit     - 退出',
              '',
              '快捷键:',
              '  ↑↓       - 浏览输入历史',
              '  Tab      - 命令补全',
              '  PageUp/Down - 翻页浏览对话',
              '  Ctrl+Home/End - 跳到对话首/尾',
            ].join('\n'),
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (content === '/ink') {
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
          },
          {
            id: `ink-info-${Date.now()}`,
            role: 'system',
            content:
              '当前运行: PY_APP Ink TUI 模式 (React-for-CLI) — 流式输出、工具调用可视化、Markdown 渲染。',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreamState('streaming');
      setStreamingContent('');
      setStreamStats({ startTime: Date.now(), tokenCount: 0, currentSpeed: 0 });
      setActiveToolCalls([]);

      const controller = new AbortController();
      abortRef.current = controller;

      let tokenCount = 0;
      let accumulated = '';
      let lastTokenTime = Date.now();
      const pauseCheckInterval = setInterval(() => {
        const elapsed = Date.now() - lastTokenTime;
        if (elapsed > STREAM_PAUSE_THRESHOLD_MS && accumulated.length === 0) {
          setActiveToolCalls((prev) => {
            if (prev.length > 0) return prev;
            return [
              {
                toolCallId: `pause-${Date.now()}`,
                toolName: '工具调用中...',
                startedAt: lastTokenTime,
                status: 'running',
              },
            ];
          });
        }
      }, 500);

      try {
        const currentSession = chatManager.getCurrentSession();
        const stream = chatManager.streamMessage(content, {
          sessionId: currentSession?.id,
        });

        let result = await stream.next();
        while (!result.done) {
          if (controller.signal.aborted) break;

          const chunk = result.value as string;
          accumulated += chunk;
          tokenCount++;
          lastTokenTime = Date.now();
          setActiveToolCalls([]);

          setStreamingContent(accumulated);

          const elapsed = Date.now() - (streamStats?.startTime || Date.now());
          const speed =
            elapsed > 0 ? Math.round((tokenCount / elapsed) * 1000) : 0;
          setStreamStats({
            startTime: streamStats?.startTime || Date.now(),
            tokenCount,
            currentSpeed: speed,
          });

          if (isPausedRef.current) {
            await new Promise<void>((resolve) => {
              pauseResolveRef.current = resolve;
            });
          }

          result = await stream.next();
        }

        const finalMessage = result.value as {
          content?: string | object;
          tool_calls?: Array<Record<string, unknown>>;
        };
        const finalContent = finalMessage?.content || accumulated;

        if (controller.signal.aborted) {
          const partialContent =
            typeof finalContent === 'string'
              ? finalContent
              : JSON.stringify(finalContent);
          const interruptedContent = partialContent
            ? `${partialContent}\n\n[已中断]`
            : '[已中断]';
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: interruptedContent,
              timestamp: Date.now(),
            },
          ]);
          setStreamState('done');
          return;
        }

        const completedToolCalls: ToolCallInfo[] =
          finalMessage?.tool_calls?.map((tc: Record<string, unknown>) => {
            const fn = (tc.function || {}) as Record<string, unknown>;
            return {
              id: (tc.id as string) || '',
              name: (fn.name as string) || (tc.name as string) || 'unknown',
              arguments: (fn.arguments
                ? typeof fn.arguments === 'string'
                  ? JSON.parse(fn.arguments as string)
                  : fn.arguments
                : tc.arguments || {}) as Record<string, unknown>,
            };
          }) || [];

        setActiveToolCalls([]);
        setStreamState('done');

        const contentStr =
          typeof finalContent === 'string'
            ? finalContent
            : finalContent && typeof finalContent === 'object'
              ? JSON.stringify(finalContent)
              : '';

        const hasToolCalls = completedToolCalls.length > 0;
        const displayContent =
          contentStr || (hasToolCalls ? '[已执行工具调用]' : '（无响应内容）');

        const assistantMsg: DisplayMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: displayContent,
          timestamp: Date.now(),
          toolCalls: hasToolCalls ? completedToolCalls : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        logger.error('streamMessage 失败', { error: String(err) });
        setStreamState('idle');
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'system',
            content: `错误: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          },
        ]);
      } finally {
        clearInterval(pauseCheckInterval);
        setActiveToolCalls([]);
        setStreamingContent('');
        if (streamState === 'streaming') {
          setStreamState('idle');
        }
      }
    },
    [chatManager, streamStats, exit, onExit]
  );

  const conversationHeight = Math.max(6, terminalHeight - 6);

  useEffect(() => {
    const handler = () => {
      if (streamState === 'streaming') {
        abortRef.current?.abort();
      }
    };
    process.on('SIGINT', handler);
    return () => {
      process.removeListener('SIGINT', handler);
    };
  }, [streamState]);

  return (
    <AlternateScreen>
      <Box flexDirection="column" height={terminalHeight} width="100%">
        <Header chatManager={chatManager} messageCount={messages.length} />
        <ConversationArea
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={streamState === 'streaming'}
          streamState={streamState}
          activeToolCalls={activeToolCalls}
          height={conversationHeight}
        />
        <Box flexDirection="column">
          <StatusBar
            streamStats={streamStats}
            streamState={streamState}
            submitCount={submitCount}
          />
          <InputArea
            onSubmit={handleSubmit}
            disabled={streamState === 'streaming' || streamState === 'paused'}
            onEscape={handleEscape}
          />
        </Box>
      </Box>
    </AlternateScreen>
  );
};
