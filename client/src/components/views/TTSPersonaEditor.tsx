import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getBackendBaseUrl } from "../../services/backendUrl";

/**
 * TTS 人设编辑器（模态弹窗）
 *
 * 支持创建和编辑两种模式：不传 persona 时为创建模式，传 persona 时为编辑模式。
 * 提交后调用 onSaved 回调，由父组件触发列表刷新。
 */
interface TTSPersona {
  id: string;
  name: string;
  description?: string;
  provider: string;
  voice: string;
  speed: number;
  language: string;
  format?: string;
}

interface TTSPersonaEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona?: TTSPersona | null;
  onSaved: () => void;
}

export function TTSPersonaEditor({
  open,
  onOpenChange,
  persona,
  onSaved,
}: TTSPersonaEditorProps) {
  const isEditing = !!persona;

  // 表单状态
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("edge");
  const [voice, setVoice] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [language, setLanguage] = useState("zh-CN");
  const [format, setFormat] = useState("mp3");
  const [providers, setProviders] = useState<string[]>([]);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 打开时初始化表单数据 */
  useEffect(() => {
    if (!open) return;

    if (persona) {
      setName(persona.name);
      setDescription(persona.description ?? "");
      setProvider(persona.provider);
      setVoice(persona.voice);
      setSpeed(persona.speed);
      setLanguage(persona.language);
      setFormat(persona.format ?? "mp3");
    } else {
      // 创建模式：重置表单
      setName("");
      setDescription("");
      setProvider("edge");
      setVoice("");
      setSpeed(1.0);
      setLanguage("zh-CN");
      setFormat("mp3");
    }

    setError(null);

    // 加载 Provider 列表
    (async () => {
      try {
        const response = await fetch(`${getBackendBaseUrl()}/v1/voice/providers`);
        const data = await response.json();
        if (Array.isArray(data)) {
          setProviders(data);
        }
      } catch {
        // 静默降级
      }
    })();
  }, [open, persona]);

  /** Provider 变更时加载对应语音列表 */
  useEffect(() => {
    if (!provider) return;

    (async () => {
      try {
        const response = await fetch(
          `${getBackendBaseUrl()}/v1/voice/voices?provider=${encodeURIComponent(provider)}`
        );
        const data = await response.json();
        if (Array.isArray(data)) {
          setVoices(data);
        }
      } catch {
        // 静默降级
      }
    })();
  }, [provider]);

  /** 提交表单 */
  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("人设名称不能为空");
      return;
    }
    if (!provider) {
      setError("请选择 TTS 提供商");
      return;
    }
    if (!voice) {
      setError("请选择语音");
      return;
    }

    setSaving(true);
    setError(null);

    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      provider,
      voice,
      speed,
      language,
      format,
    };

    try {
      if (isEditing) {
        const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas/${persona!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("更新人设失败");
      } else {
        const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("创建人设失败");
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存人设失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "编辑人设" : "新建人设"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              名称 <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给这个人设取个名字"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="人设描述（可选）"
              rows={2}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm resize-none"
            />
          </div>

          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              TTS 提供商 <span className="text-red-500">*</span>
            </label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setVoice("");
              }}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* 语音 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              语音 <span className="text-red-500">*</span>
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
            >
              {!voice && <option value="">请选择语音</option>}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

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

          {/* 语言 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              语言代码
            </label>
            <Input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="如 zh-CN、en-US"
            />
          </div>

          {/* 音频格式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              音频格式
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
            >
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
              <option value="ogg">OGG</option>
              <option value="pcm">PCM</option>
            </select>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded text-sm">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "保存中..." : isEditing ? "更新人设" : "创建人设"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
