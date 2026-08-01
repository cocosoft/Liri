/**
 * 设置 Tab — 参数调整 + 系统提示词编辑
 * 模型选择已统一收敛到 Footer ModelSwitcher 作为唯一入口
 */

import React from "react";
import { useState, useCallback } from "react";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import { useConfigStore } from "../../stores/configStore";

const SAVE_SCOPES = [
  { value: "session", label: "仅当前会话（不持久化）" },
  { value: "global", label: "全局默认（影响新对话）" },
  { value: "model", label: "模型预设（切换模型时自动应用）" },
] as const;

function SliderControlImpl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {value.toFixed(step < 1 ? 1 : 0)}
          {hint && (
            <span className="ml-1 text-gray-400 font-normal">({hint})</span>
          )}
        </span>
      </div>
      <div className="relative h-5 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-sm"
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-blue-500 rounded-full pointer-events-none"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
const SliderControl = React.memo(SliderControlImpl);

function SettingsTab() {
  const chatParams = useConfigStore((s) => s.chatParams);
  const setChatParams = useConfigStore((s) => s.setChatParams);
  const { isLoading } = useModelSwitchStore();

  const [temperature, setTemperature] = useState(chatParams.temperature);
  const [topP, setTopP] = useState(chatParams.topP);
  const [maxTokens, setMaxTokens] = useState(chatParams.maxTokens);
  const [systemPrompt, setSystemPrompt] = useState(chatParams.systemPrompt);
  const [saveScope, setSaveScope] = useState<string>("global");

  const handleSave = useCallback(async () => {
    await setChatParams({ temperature, topP, maxTokens, systemPrompt });
  }, [temperature, topP, maxTokens, systemPrompt, setChatParams]);

  return (
    <div className="p-3 space-y-5">
      <SliderControl
        label="温度 Temperature"
        value={temperature}
        min={0}
        max={2}
        step={0.1}
        onChange={setTemperature}
        hint="保存后生效"
      />
      <SliderControl
        label="多样性 Top P"
        value={topP}
        min={0}
        max={1}
        step={0.05}
        onChange={setTopP}
        hint="保存后生效"
      />
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          最大输出 Token
        </h4>
        <select
          value={maxTokens}
          onChange={(e) => setMaxTokens(parseInt(e.target.value))}
          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {[512, 1024, 2048, 4096, 8192, 16384].map((v) => (
            <option key={v} value={v}>
              {v.toLocaleString()}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400">保存后生效</p>
      </div>
      <hr className="border-gray-200 dark:border-gray-700" />
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          系统提示词
        </h4>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="输入系统提示词..."
        />
      </div>
      <hr className="border-gray-200 dark:border-gray-700" />
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          保存设置
        </h4>
        <div className="space-y-1.5">
          {SAVE_SCOPES.map((scope) => (
            <label
              key={scope.value}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <input
                type="radio"
                name="saveScope"
                value={scope.value}
                checked={saveScope === scope.value}
                onChange={() => setSaveScope(scope.value)}
                className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-gray-600 dark:text-gray-400">
                {scope.label}
              </span>
            </label>
          ))}
        </div>
      </div>
      <button
        className="w-full py-2 px-4 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50"
        disabled={isLoading}
        onClick={handleSave}
      >
        保存
      </button>
    </div>
  );
}

export default React.memo(SettingsTab);
