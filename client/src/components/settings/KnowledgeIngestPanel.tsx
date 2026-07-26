import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { httpLegacy as http } from "../../services/httpClient";
import { ConfigSection, ConfigItem } from "./ConfigComponents";
import { createLogger } from "@/utils/logger";

const logger = createLogger("settings:knowledgeIngest");

interface KnowledgeIngestPanelProps {
  isDark: boolean;
}

/** 内置默认规则说明 */
const DEFAULT_RULES_INFO = [
  {
    label: "文本/代码文件",
    exts: ".md, .ts, .py, .rs, .json, .svg …",
    action: "完整处理 + AI 分类",
  },
  {
    label: "图片/音视频/字体",
    exts: ".jpg, .png, .gif, .mp3, .mp4, .ttf …",
    action: "仅落库（复制 + 元数据）",
  },
  {
    label: "编译产物/压缩包",
    exts: ".exe, .dll, .zip, .pyc, .wasm …",
    action: "彻底跳过",
  },
];

function KnowledgeIngestPanel({ isDark }: KnowledgeIngestPanelProps) {
  const { t } = useTranslation();
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputInclude, setInputInclude] = useState("");
  const [inputExclude, setInputExclude] = useState("");

  /** 加载配置 */
  const loadConfig = useCallback(async () => {
    try {
      const [includeRes, excludeRes] = await Promise.all([
        http.get<{ key: string; value: string[] }>(
          "/v1/config/knowledge.ingest.include",
        ),
        http.get<{ key: string; value: string[] }>(
          "/v1/config/knowledge.ingest.exclude",
        ),
      ]);
      if (includeRes?.value && Array.isArray(includeRes.value)) {
        setIncludeTags(includeRes.value);
      }
      if (excludeRes?.value && Array.isArray(excludeRes.value)) {
        setExcludeTags(excludeRes.value);
      }
    } catch (err) {
      logger.warn("知识库摄入配置加载失败", { error: String(err) });
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /** 保存配置 */
  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    setError(null);
    try {
      await Promise.all([
        http.put("/v1/config/knowledge.ingest.include", {
          value: includeTags,
        }),
        http.put("/v1/config/knowledge.ingest.exclude", {
          value: excludeTags,
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError("保存失败: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  /** 添加标签 */
  const addTag = (
    tag: string,
    tags: string[],
    setter: (t: string[]) => void,
    inputSetter: (v: string) => void,
  ) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    setter([...tags, trimmed]);
    inputSetter("");
  };

  /** 删除标签 */
  const removeTag = (
    tag: string,
    tags: string[],
    setter: (t: string[]) => void,
  ) => {
    setter(tags.filter((t) => t !== tag));
  };

  /** 标签输入框 keydown 处理 */
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    tags: string[],
    setter: (t: string[]) => void,
    inputSetter: (v: string) => void,
    inputValue: string,
  ) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue, tags, setter, inputSetter);
    }
  };

  /** 标签渲染 */
  const renderTags = (tags: string[], setter: (t: string[]) => void) => (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
            isDark ? "bg-blue-900/40 text-blue-300" : "bg-blue-50 text-blue-700"
          }`}
        >
          {tag}
          <button
            onClick={() => removeTag(tag, tags, setter)}
            className="hover:opacity-70 ml-0.5"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <ConfigSection
      isDark={isDark}
    >
      {/* 内置规则说明 */}
      <div
        className={`mb-4 p-3 rounded text-xs ${
          isDark ? "bg-gray-700/50 text-gray-400" : "bg-gray-50 text-gray-500"
        }`}
      >
        <p className="font-medium mb-2">内置默认规则：</p>
        <ul className="space-y-1">
          {DEFAULT_RULES_INFO.map((rule) => (
            <li key={rule.label} className="flex gap-2">
              <span className="whitespace-nowrap font-medium">
                {rule.label}：
              </span>
              <span className="text-gray-400">{rule.exts}</span>
              <span className="ml-auto text-gray-400">→ {rule.action}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 白名单 */}
      <ConfigItem
        label="白名单（include）"
        description="配置后仅落库列表中的类型，内置规则失效。留空则关闭白名单模式。"
        isDark={isDark}
      >
        {renderTags(includeTags, setIncludeTags)}
        <input
          type="text"
          value={inputInclude}
          onChange={(e) => setInputInclude(e.target.value)}
          onKeyDown={(e) =>
            handleKeyDown(
              e,
              includeTags,
              setIncludeTags,
              setInputInclude,
              inputInclude,
            )
          }
          onBlur={() =>
            inputInclude &&
            addTag(inputInclude, includeTags, setIncludeTags, setInputInclude)
          }
          placeholder="输入扩展名后按 Enter，如 .md"
          className={`w-full px-3 py-1.5 text-sm border rounded ${
            isDark
              ? "bg-gray-700 border-gray-600 text-gray-100"
              : "bg-white border-gray-300 text-gray-900"
          }`}
        />
        <p
          className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          格式：.md, .txt, .jpg（支持带点和不带点）
        </p>
      </ConfigItem>

      {/* 黑名单 */}
      <ConfigItem
        label="黑名单（exclude）"
        description="在 include 未配置时生效，在内置规则基础上额外排除的类型。"
        isDark={isDark}
      >
        {renderTags(excludeTags, setExcludeTags)}
        <input
          type="text"
          value={inputExclude}
          onChange={(e) => setInputExclude(e.target.value)}
          onKeyDown={(e) =>
            handleKeyDown(
              e,
              excludeTags,
              setExcludeTags,
              setInputExclude,
              inputExclude,
            )
          }
          onBlur={() =>
            inputExclude &&
            addTag(inputExclude, excludeTags, setExcludeTags, setInputExclude)
          }
          placeholder="输入扩展名后按 Enter，如 .log"
          className={`w-full px-3 py-1.5 text-sm border rounded ${
            isDark
              ? "bg-gray-700 border-gray-600 text-gray-100"
              : "bg-white border-gray-300 text-gray-900"
          }`}
        />
        <p
          className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          include 和 exclude 同时配置时，include 优先
        </p>
      </ConfigItem>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={loading}
          className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "保存中..." : t("common.save")}
        </button>
        {saved && <span className="text-xs text-green-500">已保存</span>}
        {error && (
          <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
            {error}
          </span>
        )}
      </div>
    </ConfigSection>
  );
}

export default KnowledgeIngestPanel;
