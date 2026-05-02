/**
 * 设置面板组件
 * 用于显示和管理应用设置
 */

import React, { useState } from 'react';

export interface SettingItem {
  id: string;
  label: string;
  type: 'toggle' | 'select' | 'input' | 'slider';
  value: boolean | string | number;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}

export interface SettingsPanelProps {
  settings: SettingItem[];
  onSettingChange: (id: string, value: boolean | string | number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onSettingChange,
  isOpen,
  onClose,
}) => {
  const [localSettings, setLocalSettings] = useState<SettingItem[]>(settings);

  const handleChange = (id: string, value: boolean | string | number) => {
    setLocalSettings((prev) =>
      prev.map((setting) =>
        setting.id === id ? { ...setting, value } : setting
      )
    );
    onSettingChange(id, value);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <div className="space-y-4">
            {localSettings.map((setting) => (
              <div key={setting.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      {setting.label}
                    </label>
                    {setting.description && (
                      <p className="text-xs text-gray-500 mt-1">
                        {setting.description}
                      </p>
                    )}
                  </div>

                  {setting.type === 'toggle' && (
                    <button
                      onClick={() =>
                        handleChange(setting.id, !(setting.value as boolean))
                      }
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        setting.value ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          setting.value ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  )}

                  {setting.type === 'select' && setting.options && (
                    <select
                      value={setting.value as string}
                      onChange={(e) => handleChange(setting.id, e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {setting.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {setting.type === 'input' && (
                    <input
                      type="text"
                      value={setting.value as string}
                      onChange={(e) => handleChange(setting.id, e.target.value)}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}

                  {setting.type === 'slider' && (
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={setting.min}
                        max={setting.max}
                        step={setting.step}
                        value={setting.value as number}
                        onChange={(e) =>
                          handleChange(setting.id, parseFloat(e.target.value))
                        }
                        className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-sm text-gray-600 w-12 text-right">
                        {setting.value}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={() =>
              setLocalSettings(settings.map((s) => ({ ...s })))
            }
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 创建设置面板组件
 */
export function createSettingsPanel(props: SettingsPanelProps): React.ReactElement {
  return <SettingsPanel {...props} />;
}
