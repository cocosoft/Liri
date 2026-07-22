/**
 * TTSHistoryItem — 合成历史记录单项组件
 *
 * 显示单条合成历史：文本摘要（截断）、时间、字符数，
 * 提供 [再次合成] 按钮回填文本到输入框。
 *
 * 仅含元数据，不含 base64 音频数据。
 */

/** 合成历史条目（仅元数据，不含 base64 音频） */
export interface SynthesisHistoryItem {
  id: string;
  text: string;
  charCount: number;
  provider: string;
  voice: string;
  speed: number;
  createdAt: number;
}

/** TTSHistoryItem 组件 Props */
interface TTSHistoryItemProps {
  item: SynthesisHistoryItem;
  onReSynthesize: (item: SynthesisHistoryItem) => void;
}

/**
 * 合成历史单项组件
 *
 * @param item - 历史条目数据
 * @param onReSynthesize - [再次合成] 回调，将文本回填到输入框
 */
function TTSHistoryItem({ item, onReSynthesize }: TTSHistoryItemProps) {
  return (
    <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-sm">
      <div className="flex-1 min-w-0 mr-2">
        <p className="truncate text-gray-700 dark:text-gray-300">{item.text}</p>
        <p className="text-xs text-gray-400">
          {new Date(item.createdAt).toLocaleTimeString()} · {item.charCount}字
        </p>
      </div>
      <button
        onClick={() => onReSynthesize(item)}
        className="shrink-0 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
        title="回填文本到输入框（使用当前语音设置）"
      >
        ↻ 再次合成
      </button>
    </div>
  );
}

export default TTSHistoryItem;
