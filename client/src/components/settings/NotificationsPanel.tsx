import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  SelectConfig,
  ToggleConfig,
  TextConfig,
} from "./ConfigComponents";

interface NotificationsConfig {
  preferredChannel: "auto" | "native" | "none";
  idleThresholdMs: number;
  taskCompleteEnabled: boolean;
  inputNeededEnabled: boolean;
  agentPushEnabled: boolean;
}

interface NotificationsPanelProps {
  isDark: boolean;
  notifications: NotificationsConfig;
  onUpdate: (updates: Partial<NotificationsConfig>) => void;
}

/** 请求浏览器通知权限（仅当未决定时） */
function requestNotificationPermission(t: (key: string) => string): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    alert(t("settings.notificationsBlockedAlert"));
  }
}

function NotificationsPanel({
  isDark,
  notifications,
  onUpdate,
}: NotificationsPanelProps) {
  const { t } = useTranslation();

  return (
    <ConfigSection
      title={t("settings.notifications")}
      description={t("settings.notificationsDesc")}
      isDark={isDark}
    >
      <div className="space-y-4">
        <ConfigItem label={t("settings.notificationsChannel")} isDark={isDark}>
          <SelectConfig
            isDark={isDark}
            value={notifications.preferredChannel}
            onChange={(value) =>
              onUpdate({
                preferredChannel:
                  value as NotificationsConfig["preferredChannel"],
              })
            }
            options={[
              { value: "auto", label: t("settings.notificationsChannelAuto") },
              { value: "native", label: t("settings.notificationsChannelNative") },
              { value: "none", label: t("settings.notificationsChannelNone") },
            ]}
          />
        </ConfigItem>

        <ConfigItem
          label={t("settings.notificationsIdleThreshold")}
          description={t("settings.notificationsIdleThresholdDesc")}
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(notifications.idleThresholdMs)}
            onChange={(value) =>
              onUpdate({ idleThresholdMs: parseInt(value, 10) || 60000 })
            }
            placeholder="60000"
            className="w-32"
          />
        </ConfigItem>

        <div className={`h-px ${isDark ? "bg-gray-700" : "bg-gray-200"}`} />

        <ConfigItem
          label={t("settings.notificationsTaskComplete")}
          description={t("settings.notificationsTaskCompleteDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={notifications.taskCompleteEnabled}
            onChange={(checked) => {
              onUpdate({ taskCompleteEnabled: checked });
              if (checked) requestNotificationPermission(t);
            }}
          />
        </ConfigItem>

        <ConfigItem
          label={t("settings.notificationsInputNeeded")}
          description={t("settings.notificationsInputNeededDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={notifications.inputNeededEnabled}
            onChange={(checked) => {
              onUpdate({ inputNeededEnabled: checked });
              if (checked) requestNotificationPermission(t);
            }}
          />
        </ConfigItem>

        <ConfigItem
          label={t("settings.notificationsAgentPush")}
          description={t("settings.notificationsAgentPushDesc")}
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={notifications.agentPushEnabled}
            onChange={(checked) => onUpdate({ agentPushEnabled: checked })}
          />
        </ConfigItem>
      </div>
    </ConfigSection>
  );
}

export default NotificationsPanel;
