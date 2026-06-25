import { useState, useEffect } from "react";
import { getBackendBaseUrl } from "../../services/backendUrl";

/**
 * 语音选择器组件
 *
 * 根据当前选中的 TTS Provider 动态加载可用语音列表。
 * 支持按语言分组展示，方便用户查找。
 * 可选的格式选择器从 supportedFormats 动态渲染。
 */
interface Voice {
  id: string;
  name: string;
  language: string;
}

interface VoiceSelectorProps {
  provider: string;
  value: string;
  onChange: (voiceId: string) => void;
  /** 支持的音频格式列表，非空时渲染格式选择器 */
  supportedFormats?: string[];
  /** 当前选中的音频格式 */
  activeFormat?: string;
  /** 音频格式变更回调 */
  onFormatChange?: (format: string) => void;
}

export function VoiceSelector({
  provider,
  value,
  onChange,
  supportedFormats,
  activeFormat,
  onFormatChange,
}: VoiceSelectorProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(false);

  /** 根据 Provider 加载语音列表 */
  useEffect(() => {
    if (!provider) return;

    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${getBackendBaseUrl()}/v1/voice/voices?provider=${encodeURIComponent(provider)}`
        );
        const data = await response.json();
        if (Array.isArray(data)) {
          setVoices(data);
        }
      } catch {
        // 后端未就绪时保持空列表
      } finally {
        setLoading(false);
      }
    })();
  }, [provider]);

  /** 按语言分组 */
  const grouped = voices.reduce<Record<string, Voice[]>>((acc, v) => {
    const lang = v.language || "未分类";
    if (!acc[lang]) acc[lang] = [];
    acc[lang].push(v);
    return acc;
  }, {});

  // 语言排序：当前选中语言的组优先
  const sortedLanguages = Object.keys(grouped).sort((a, b) => {
    const aHasValue = grouped[a].some((v) => v.id === value);
    const bHasValue = grouped[b].some((v) => v.id === value);
    if (aHasValue && !bHasValue) return -1;
    if (!aHasValue && bHasValue) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-3">
      {/* 语音选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          语音
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
        >
          {loading && <option value="">加载中...</option>}
          {!loading && voices.length === 0 && (
            <option value="">暂无可用语音</option>
          )}
          {sortedLanguages.map((lang) => (
            <optgroup key={lang} label={lang}>
              {grouped[lang].map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* 音频格式选择（从 supportedFormats 动态渲染） */}
      {supportedFormats && supportedFormats.length > 0 && onFormatChange && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            音频格式
          </label>
          <select
            value={activeFormat || supportedFormats[0]}
            onChange={(e) => onFormatChange(e.target.value)}
            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
          >
            {supportedFormats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 无可选格式时的只读标签 */}
      {supportedFormats &&
        supportedFormats.length > 0 &&
        !onFormatChange && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              音频格式
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {supportedFormats.join(", ")}
            </p>
          </div>
        )}
    </div>
  );
}
