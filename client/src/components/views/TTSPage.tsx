import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { WaveformIcon } from "../../assets/icons/navigation";
import { TTSProviderSection } from "./TTSProviderSection";
import { VoiceSelector } from "./VoiceSelector";
import { TTSPersonaManager } from "./TTSPersonaManager";
import TTSPlayground from "./TTSPlayground";
import { getBackendBaseUrl } from "../../services/backendUrl";

/**
 * TTS 语音管理主页面
 *
 * 包含 4 个 Section：Provider 配置、语音与语速、人设管理、合成测试 Playground。
 * 初始化时执行轻量健康检测，无 Provider 时显示空状态引导。
 */

/** Provider 详情类型 */
interface ProviderDetail {
  name: string;
  supportedFormats: string[];
}

function TTSPage() {
  const navigate = useNavigate();

  // ── TTS Provider 状态 ──
  const [initialized, setInitialized] = useState(false);
  const [hasProviders, setHasProviders] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [providerDetails, setProviderDetails] = useState<ProviderDetail[]>([]);

  // ── 语音与语速 ──
  const [activeProvider, setActiveProvider] = useState("edge");
  const [activeVoice, setActiveVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [activeFormat, setActiveFormat] = useState("mp3");
  const [speed, setSpeed] = useState(1.0);

  // ── 初始化：检测 TTS Provider 可用性 ──
  useEffect(() => {
    (async () => {
      try {
        // 从 /v1/tts/providers 获取 TTS Provider 列表（含 supportedFormats）
        const response = await fetch(`${getBackendBaseUrl()}/v1/tts/providers`);
        const data: ProviderDetail[] = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setProviderDetails(data);
          setProviders(data.map((p) => p.name));
          setHasProviders(true);
        }
      } catch {
        // 后端未就绪，标记无 Provider
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

  /** 获取当前 Provider 支持的格式 */
  const currentFormats = (() => {
    const detail = providerDetails.find((p) => p.name === activeProvider);
    return detail?.supportedFormats;
  })();

  /** Provider 变更时重置语音和格式 */
  const handleProviderChange = (newProvider: string) => {
    setActiveProvider(newProvider);
    setActiveVoice("");
    // 切换 Provider 后自动选第一个支持的格式
    const detail = providerDetails.find((p) => p.name === newProvider);
    if (detail && detail.supportedFormats.length > 0) {
      setActiveFormat(detail.supportedFormats[0]);
    }
  };

  // ── 未初始化：Loading ──
  if (!initialized) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  // ── 空状态：无可用 Provider ──
  if (!hasProviders) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto p-6 text-center">
          <WaveformIcon size={64} className="mx-auto mb-4 text-gray-400" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            TTS 模块尚未启动
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            请在设置中确认 TTS 提供者已启用，或在后端配置中启用 Edge TTS /
            OpenAI TTS 等提供者。
          </p>
          <button
            onClick={() => navigate("/settings")}
            className="text-blue-600 hover:underline"
          >
            前往设置 →
          </button>
        </div>
      </div>
    );
  }

  // ── 正常渲染 ──
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          TTS 语音管理
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          配置语音合成提供商、管理人设、测试合成效果
        </p>

        {/* Section 1: Provider 配置 */}
        <TTSProviderSection />

        {/* Section 2: 语音与语速 */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            语音与语速
          </h3>
          <div className="space-y-4">
            {/* Provider 选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                TTS 提供商
              </label>
              <select
                value={activeProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* 语音选择 + 格式选择 */}
            <VoiceSelector
              provider={activeProvider}
              value={activeVoice}
              onChange={setActiveVoice}
              supportedFormats={currentFormats}
              activeFormat={activeFormat}
              onFormatChange={setActiveFormat}
            />

            {/* 语速 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                语速：{speed.toFixed(1)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </section>

        {/* Section 3: 人设管理 */}
        <TTSPersonaManager />

        {/* Section 4: 合成测试 Playground */}
        <TTSPlayground
          activeVoice={activeVoice}
          activeFormat={activeFormat}
          speed={speed}
          provider={activeProvider}
        />
      </div>
    </div>
  );
}

export default TTSPage;
