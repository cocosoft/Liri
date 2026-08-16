import { useTranslation } from "react-i18next";
import { toastWarning } from "../../stores/toastStore";
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
  /** 消息中心：免打扰开关 */
  dndEnabled: boolean;
  /** 消息中心：免打扰开始时间（0-23） */
  dndStartHour: number;
  /** 消息中心：免打扰结束时间（0-23） */
  dndEndHour: number;
  /** 消息中心：分类角标开关 */
  categoryBadges: {
    approval: boolean;
    todo: boolean;
    system: boolean;
    mention: boolean;
  };
  /** 消息中心：桌面通知最小未读数阈值 */
  desktopNotifyMinUnread: number;
}

interface NotificationsPanelProps {
  isDark: boolean;
  notifications: NotificationsConfig;
  onUpdate: (updates: Partial<NotificationsConfig>) => void;
  collapsible?: boolean;
}

/** 请求浏览器通知权限（仅当未决定时） */
function requestNotificationPermission(t: (key: string) => string): void {
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "default"
  ) {
    Notification.requestPermission();
  } else if (
    typeof Notification !== "undefined" &&
    Notification.permission === "denied"
  ) {
    toastWarning(t("settings.notificationsBlockedAlert"));
  }
}

function NotificationsPanel({
  isDark,
  notifications,
  onUpdate,
  collapsible,
}: NotificationsPanelProps) {
  const { t } = useTranslation();

  return (
    <ConfigSection
      title={t("settings.notifications")}
      description={t("settings.notificationsDesc")}
      isDark={isDark}
      collapsible={collapsible}
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
              {
                value: "native",
                label: t("settings.notificationsChannelNative"),
              },
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
            value={String(notifications.idleThresholdMs ?? 60000)}
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

        <div className={`h-px ${isDark ? "bg-gray-700" : "bg-gray-200"}`} />

        {/* 消息中心偏好 */}
        <p
          className={`text-xs font-semibold uppercase tracking-wider ${isDark ? "text-gray-400" : "text-gray-500"}`}
        >
          消息中心
        </p>

        <ConfigItem
          label="免打扰时段"
          description="免打扰时段内不弹桌面通知，仅更新角标"
          isDark={isDark}
        >
          <div className="flex items-center gap-3">
            <ToggleConfig
              isDark={isDark}
              checked={notifications.dndEnabled}
              onChange={(checked) => onUpdate({ dndEnabled: checked })}
            />
            {notifications.dndEnabled && (
              <div className="flex items-center gap-2">
                <TextConfig
                  isDark={isDark}
                  type="number"
                  value={String(notifications.dndStartHour ?? 22)}
                  onChange={(value) =>
                    onUpdate({
                      dndStartHour: Math.max(
                        0,
                        Math.min(23, parseInt(value, 10) || 22),
                      ),
                    })
                  }
                  placeholder="22"
                  className="w-14"
                />
                <span
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  时 —
                </span>
                <TextConfig
                  isDark={isDark}
                  type="number"
                  value={String(notifications.dndEndHour ?? 8)}
                  onChange={(value) =>
                    onUpdate({
                      dndEndHour: Math.max(
                        0,
                        Math.min(23, parseInt(value, 10) || 8),
                      ),
                    })
                  }
                  placeholder="8"
                  className="w-14"
                />
                <span
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  时
                </span>
              </div>
            )}
          </div>
        </ConfigItem>

        <ConfigItem
          label="桌面通知阈值"
          description="未读消息达到此数量时才弹出桌面通知（0=始终通知）"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(notifications.desktopNotifyMinUnread ?? 1)}
            onChange={(value) =>
              onUpdate({
                desktopNotifyMinUnread: Math.max(0, parseInt(value, 10) || 1),
              })
            }
            placeholder="1"
            className="w-20"
          />
        </ConfigItem>

        <ConfigItem
          label="分类角标"
          description="控制各分类是否在 Tab 栏显示未读角标"
          isDark={isDark}
        >
          <div className="space-y-2">
            {(["approval", "todo", "system", "mention"] as const).map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <ToggleConfig
                  isDark={isDark}
                  checked={notifications.categoryBadges?.[cat] ?? true}
                  onChange={(checked) =>
                    onUpdate({
                      categoryBadges: {
                        ...notifications.categoryBadges,
                        approval:
                          notifications.categoryBadges?.approval ?? true,
                        todo: notifications.categoryBadges?.todo ?? true,
                        system: notifications.categoryBadges?.system ?? true,
                        mention: notifications.categoryBadges?.mention ?? true,
                        [cat]: checked,
                      },
                    })
                  }
                />
                <span
                  className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {
                    {
                      approval: "审批",
                      todo: "待办",
                      system: "系统",
                      mention: "@提及",
                    }[cat]
                  }
                </span>
              </div>
            ))}
          </div>
        </ConfigItem>
      </div>
    </ConfigSection>
  );
}

export default NotificationsPanel;
