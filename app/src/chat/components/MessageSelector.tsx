/**
 * 消息选择器组件
 * 用于选择消息进行恢复、总结等操作
 * 参考CC源码 components/MessageSelector.tsx 实现
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Message, UserMessage } from '../types/message.js';
import { createUserMessage, isSyntheticMessage } from '../../utils/messages.js';

export type RestoreOption =
  | 'both'
  | 'conversation'
  | 'code'
  | 'summarize'
  | 'summarize_up_to'
  | 'nevermind';

export interface MessageSelectorProps {
  messages: Message[];
  onPreRestore: () => void;
  onRestoreMessage: (message: UserMessage) => Promise<void>;
  onRestoreCode: (message: UserMessage) => Promise<void>;
  onSummarize: (
    message: UserMessage,
    feedback?: string,
    direction?: string
  ) => Promise<void>;
  onClose: () => void;
  preselectedMessage?: UserMessage;
}

const MAX_VISIBLE_MESSAGES = 7;

/**
 * 过滤可选择的用户消息
 */
function selectableUserMessagesFilter(message: Message): boolean {
  if (message.role !== 'user') return false;
  if (message.isMeta) return false;
  if (isSyntheticMessage(message)) return false;
  return true;
}

/**
 * 检查是否是总结选项
 */
function isSummarizeOption(
  option: RestoreOption | null
): option is 'summarize' | 'summarize_up_to' {
  return option === 'summarize' || option === 'summarize_up_to';
}

/**
 * 消息选择器组件
 */
export function MessageSelector({
  messages,
  onPreRestore,
  onRestoreMessage,
  onRestoreCode,
  onSummarize,
  onClose,
  preselectedMessage,
}: MessageSelectorProps): React.ReactNode {
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [messageToRestore, setMessageToRestore] = useState<
    UserMessage | undefined
  >(preselectedMessage);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoringOption, setRestoringOption] = useState<RestoreOption | null>(
    null
  );
  const [selectedRestoreOption, setSelectedRestoreOption] =
    useState<RestoreOption>('both');
  const [summarizeFromFeedback, setSummarizeFromFeedback] = useState('');
  const [summarizeUpToFeedback, setSummarizeUpToFeedback] = useState('');

  // 添加当前提示作为虚拟消息
  const messageOptions = useMemo(() => {
    const filtered = messages.filter(
      selectableUserMessagesFilter
    ) as UserMessage[];
    return [
      ...filtered,
      {
        ...createUserMessage({ content: '' }),
        uuid: `current_${Date.now()}`,
      } as UserMessage,
    ];
  }, [messages]);

  // 计算可见消息范围
  const firstVisibleIndex = useMemo(() => {
    return Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(MAX_VISIBLE_MESSAGES / 2),
        messageOptions.length - MAX_VISIBLE_MESSAGES
      )
    );
  }, [selectedIndex, messageOptions.length]);

  const hasMessagesToSelect = messageOptions.length > 1;

  /**
   * 获取恢复选项
   */
  function getRestoreOptions(canRestoreCode: boolean) {
    const baseOptions = canRestoreCode
      ? [
          {
            value: 'both' as RestoreOption,
            label: 'Restore code and conversation',
          },
          {
            value: 'conversation' as RestoreOption,
            label: 'Restore conversation',
          },
          { value: 'code' as RestoreOption, label: 'Restore code only' },
        ]
      : [
          {
            value: 'conversation' as RestoreOption,
            label: 'Restore conversation',
          },
        ];

    return [
      ...baseOptions,
      { value: 'summarize' as RestoreOption, label: 'Summarize from here' },
      {
        value: 'summarize_up_to' as RestoreOption,
        label: 'Summarize up to here',
      },
      { value: 'nevermind' as RestoreOption, label: 'Nevermind' },
    ];
  }

  /**
   * 处理消息选择
   */
  const handleSelectMessage = useCallback((message: UserMessage) => {
    setMessageToRestore(message);
  }, []);

  /**
   * 处理恢复操作
   */
  const handleRestore = useCallback(async () => {
    if (!messageToRestore) return;

    onPreRestore();
    setIsRestoring(true);

    try {
      if (
        selectedRestoreOption === 'both' ||
        selectedRestoreOption === 'conversation'
      ) {
        await onRestoreMessage(messageToRestore);
      }
      if (
        selectedRestoreOption === 'both' ||
        selectedRestoreOption === 'code'
      ) {
        await onRestoreCode(messageToRestore);
      }
      if (isSummarizeOption(selectedRestoreOption)) {
        const feedback =
          selectedRestoreOption === 'summarize'
            ? summarizeFromFeedback
            : summarizeUpToFeedback;
        const direction =
          selectedRestoreOption === 'summarize' ? 'from' : 'up_to';
        await onSummarize(messageToRestore, feedback, direction);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRestoring(false);
      onClose();
    }
  }, [
    messageToRestore,
    selectedRestoreOption,
    onPreRestore,
    onRestoreMessage,
    onRestoreCode,
    onSummarize,
    onClose,
  ]);

  /**
   * 处理键盘导航
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(messageOptions.length - 1, prev + 1)
          );
          break;
        case 'Enter':
          if (messageOptions[selectedIndex]) {
            handleSelectMessage(messageOptions[selectedIndex]);
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    },
    [selectedIndex, messageOptions.length, handleSelectMessage, onClose]
  );

  useEffect(() => {
    // 初始化选中最后一条消息
    if (messageOptions.length > 0) {
      setSelectedIndex(messageOptions.length - 1);
    }
  }, [messageOptions.length]);

  // 如果没有消息可选择，直接关闭
  if (!hasMessagesToSelect) {
    return null;
  }

  return (
    <div className="message-selector">
      <h3>Select a message to restore or summarize:</h3>

      {error && <div className="error">{error}</div>}

      {/* 消息列表 */}
      <div className="message-list" onKeyDown={handleKeyDown} tabIndex={0}>
        {messageOptions
          .slice(firstVisibleIndex, firstVisibleIndex + MAX_VISIBLE_MESSAGES)
          .map((msg, idx) => {
            const actualIndex = firstVisibleIndex + idx;
            const isSelected = actualIndex === selectedIndex;
            return (
              <div
                key={msg.id}
                className={`message-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectMessage(msg)}
              >
                {typeof msg.content === 'string' ? msg.content : '(current prompt)'}
              </div>
            );
          })}
      </div>

      {/* 恢复选项 */}
      {messageToRestore && (
        <div className="restore-options">
          <h4>Restore options:</h4>
          {getRestoreOptions(true).map((option) => (
            <button
              key={option.value}
              className={
                selectedRestoreOption === option.value ? 'selected' : ''
              }
              onClick={() => setSelectedRestoreOption(option.value)}
            >
              {option.label}
            </button>
          ))}

          {/* 摘要反馈输入 */}
          {selectedRestoreOption === 'summarize' && (
            <input
              type="text"
              placeholder="Add feedback (optional)"
              value={summarizeFromFeedback}
              onChange={(e) => setSummarizeFromFeedback(e.target.value)}
            />
          )}
          {selectedRestoreOption === 'summarize_up_to' && (
            <input
              type="text"
              placeholder="Add feedback (optional)"
              value={summarizeUpToFeedback}
              onChange={(e) => setSummarizeUpToFeedback(e.target.value)}
            />
          )}

          <button onClick={handleRestore} disabled={isRestoring}>
            {isRestoring ? 'Processing...' : 'Confirm'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      )}
    </div>
  );
}
