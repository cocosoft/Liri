/**
 * ChannelFormModal — 渠道编辑模态框
 * 对标 OpenClaw HermesChannelsPage 模态框
 *
 * Phase 2: 编辑已有渠道配置 + 平台特定字段
 * Phase 3: 凭证脱敏 + 插件检测 + 保存/保存并应用
 */

import { useState, useCallback, useEffect } from "react";
import type { Channel, UpdateChannelRequest } from "../../types";
import { getPlatformFields, type PlatformFieldDef } from "./platformFields";
import { maskSecretValue, normalizeSecretInput } from "../../utils/secretMask";
import PluginInstallCard from "./PluginInstallCard";
import { useChannelStore } from "../../stores/channelStore";

// ─── 类型标签 ──────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  wechat: "微信",
  wecom: "企业微信",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "邮件",
  webhook: "Webhook",
  line: "Line",
  irc: "IRC",
  nostr: "Nostr",
  sms: "短信",
  matrix: "Matrix",
  facebook: "Facebook",
  twitter: "Twitter/X",
  signal: "Signal",
  mattermost: "Mattermost",
  bluebubbles: "iMessage",
  googlechat: "Google Chat",
  msteams: "MS Teams",
  zalo: "Zalo",
  yuanbao: "元宝",
};

const TYPE_COLORS: Record<string, string> = {
  qq: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  feishu: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  dingtalk: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  wechat:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  wecom: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  slack:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  discord:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  telegram: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  whatsapp:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  email: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400",
  webhook:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// ─── 渠道→插件包映射 ──────────────────────────────────

/** 需要插件检测的渠道映射 */
const CHANNEL_PLUGIN_MAP: Record<string, string[]> = {
  qq: ["@openclaw-china/qqbot"],
  feishu: ["@openclaw-china/feishu-china", "@openclaw/feishu"],
  dingtalk: ["@openclaw-china/dingtalk"],
  wecom: ["@openclaw-china/wecom", "@openclaw-china/wecom-app"],
};

function needsPlugin(channelType: string): string[] | null {
  return CHANNEL_PLUGIN_MAP[channelType] || null;
}

// ─── 组件 Props ────────────────────────────────────────

interface ChannelFormModalProps {
  visible: boolean;
  channel: Channel | null;
}

// ─── 单字段行 ──────────────────────────────────────────

function SecretField({
  field,
  defaultValue,
  secretMap,
  onSecretChange,
}: {
  field: PlatformFieldDef;
  defaultValue: string;
  secretMap: Record<string, string>;
  onSecretChange: (key: string, value: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const currentInput = secretMap[field.key] ?? "";
  const isDirty = currentInput.length > 0;

  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type={showPassword ? "text" : "password"}
          value={currentInput}
          onChange={(e) => onSecretChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="px-2 py-2 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title={showPassword ? "隐藏" : "显示"}
        >
          {showPassword ? "🙈" : "👁"}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {defaultValue && (
          <span className="text-xs text-gray-400">
            当前: {maskSecretValue(defaultValue)}
          </span>
        )}
        {isDirty && (
          <span className="text-xs text-orange-500 font-medium">待更新</span>
        )}
      </div>
    </div>
  );
}

function TextField({
  field,
  value,
  onChange,
}: {
  field: PlatformFieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={field.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────

function ChannelFormModal({ visible, channel }: ChannelFormModalProps) {
  const {
    closeFormModal,
    saveChannel,
    saveAndApplyChannel,
    isSaving,
    isApplying,
    isChannelPluginInstalled,
    isInstallingPlugin,
    installChannelPlugin,
  } = useChannelStore();

  // 表单本地状态 — 所有 hooks 必须在顶层，不能放在条件返回之后
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [textFields, setTextFields] = useState<Record<string, string>>({});
  const [secretFields, setSecretFields] = useState<Record<string, string>>({});

  // 每次 channel 变化时初始化表单（用 useEffect 避免 render 中 setState）
  const [lastChannelId, setLastChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (!channel || channel.id === lastChannelId) return;
    setLastChannelId(channel.id);
    setName(channel.name);
    setEnabled(channel.enabled);

    const cfg = channel.config || {};
    const texts: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    const fields = getPlatformFields(channel.type);
    for (const f of fields) {
      const val = cfg[f.key];
      if (val !== undefined && val !== null) {
        if (f.type === "password") {
          secrets[f.key] = "";
        } else {
          texts[f.key] = String(val);
        }
      }
    }
    setTextFields(texts);
    setSecretFields(secrets);
  }, [channel, lastChannelId]);

  // 构建保存数据 — 使用 useCallback 必须在条件返回之前
  const buildSaveData = useCallback((): UpdateChannelRequest => {
    const config: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(textFields)) {
      if (val) config[key] = val;
    }
    for (const [key, val] of Object.entries(secretFields)) {
      const normalized = normalizeSecretInput(val);
      if (normalized) config[key] = normalized;
    }
    return {
      name: name || undefined,
      enabled,
      config: Object.keys(config).length > 0 ? config : undefined,
    };
  }, [name, enabled, textFields, secretFields]);

  // 派生数据 — 必须在条件返回之前
  const fields = channel ? getPlatformFields(channel.type) : [];
  const pluginRequired = channel ? needsPlugin(channel.type) : null;

  if (!visible || !channel) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50" onClick={closeFormModal} />

      {/* 模态框 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            编辑渠道
          </h3>
          <button
            onClick={closeFormModal}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* 未注册提示 */}
          {!channel.registered && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
              此渠道尚未注册。如需启用，请在后端配置对应的环境变量后重启服务。
            </div>
          )}

          {/* 类型（只读） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              类型
            </label>
            <span
              className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${TYPE_COLORS[channel.type] || "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400"}`}
            >
              {TYPE_LABELS[channel.type] || channel.type}
            </span>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={channel.name}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 插件检测 — QQ/飞书/钉钉/企业微信 需要安装对应插件 */}
          {pluginRequired && !isChannelPluginInstalled(channel.type) && (
            <PluginInstallCard
              channelLabel={TYPE_LABELS[channel.type] || channel.type}
              pluginNames={pluginRequired}
              isInstalling={isInstallingPlugin}
              onInstall={() => installChannelPlugin(channel.type)}
            />
          )}

          {/* 认证配置 */}
          {fields.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">
                认证配置
              </h4>
              <div>
                {fields.map((field) =>
                  field.type === "password" ? (
                    <SecretField
                      key={field.key}
                      field={field}
                      defaultValue={String(
                        (channel.config || {})[field.key] || "",
                      )}
                      secretMap={secretFields}
                      onSecretChange={(key, value) =>
                        setSecretFields((prev) => ({ ...prev, [key]: value }))
                      }
                    />
                  ) : (
                    <TextField
                      key={field.key}
                      field={field}
                      value={textFields[field.key] || ""}
                      onChange={(value) =>
                        setTextFields((prev) => ({
                          ...prev,
                          [field.key]: value,
                        }))
                      }
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {/* 行为配置 */}
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">
              行为配置
            </h4>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                启用
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <span className="text-xs text-gray-400">
            {isApplying ? "正在应用配置..." : ""}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={closeFormModal}
              disabled={isSaving || isApplying}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={() => saveChannel(buildSaveData())}
              disabled={isSaving || isApplying || !channel.registered}
              title={!channel.registered ? "未注册渠道无法保存" : "保存配置"}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2"
            >
              {isSaving && !isApplying ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => saveAndApplyChannel(buildSaveData())}
              disabled={isSaving || isApplying || !channel.registered}
              title={
                !channel.registered ? "未注册渠道无法应用" : "保存并应用配置"
              }
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2"
            >
              {isApplying ? "应用中..." : "保存并应用"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChannelFormModal;
