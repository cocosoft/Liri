/**
 * 审批放行开关（R3/F2）—— 从 `ToolRulesSection` 原样拆出，文案/类名不变。
 *
 * 三个粒度：全局 / 仅当前会话 / 按工作区根。作用范围都是**审批生成的规则**；
 * 规则本身仍可在下方列表逐条撤销。状态与写入全部在父组件，本组件只做展示与回调。
 */
import { useTranslation } from "react-i18next";
import type { ApprovalPauseState } from "../../../services/permissionService";

interface Props {
  isDark: boolean;
  /** `null`（后端未返回）⇒ 控件禁用，不给"可暂停"的假承诺 */
  pause: ApprovalPauseState | null;
  /** 当前活跃会话（无 ⇒ 会话级开关禁用并如实提示） */
  currentSessionId: string | null | undefined;
  /** 当前会话绑定的工作区根（未绑定 ⇒ 控件禁用并如实提示） */
  currentWorkspacePath: string | undefined;
  /** 当前工作区是否已在暂停列表（归一化比较由父组件完成） */
  currentWorkspacePaused: boolean;
  /** 审批生成规则条数（仅展示） */
  approvalCount: number;
  busy: boolean;
  onToggleGlobal: () => void;
  onToggleSession: () => void;
  /** 切换「当前工作区」的暂停态（列表增/删由父组件算） */
  onToggleWorkspace: () => void;
  /** 整体替换已暂停根列表（服务端语义） */
  onSetWorkspaces: (next: string[]) => void;
}

export default function ApprovalPausePanel({
  isDark,
  pause,
  currentSessionId,
  currentWorkspacePath,
  currentWorkspacePaused,
  approvalCount,
  busy,
  onToggleGlobal,
  onToggleSession,
  onToggleWorkspace,
  onSetWorkspaces,
}: Props) {
  const { t } = useTranslation();
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const rowBg = isDark ? "bg-gray-800/60" : "bg-gray-50";
  // F2：按工作区暂停（列表为服务端归一化后的根；勾选态由父组件归一化比较得出）
  const pausedWorkspaceRoots = pause?.workspaces ?? [];

  return (
    <>
      {/* R3/F2：审批放行开关（全局 + 仅当前会话；作用范围=审批生成的规则；仍可逐条撤销） */}
      <div className={`flex items-center gap-2 rounded px-3 py-1.5 ${rowBg}`}>
        <label className="flex items-center gap-2 text-xs flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={pause?.global ?? pause?.enabled ?? false}
            disabled={!pause || busy}
            onChange={onToggleGlobal}
          />
          <span>{t("settings.toolsRulesPauseLabel")}</span>
          {(pause?.global ?? pause?.enabled) && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {t("settings.toolsRulesPauseEnabled")}
            </span>
          )}
        </label>
        <span className={`text-[10px] ${muted}`}>
          {t("settings.toolsRulesApprovals", { count: approvalCount })}
        </span>
      </div>
      <p className={`text-[11px] ${muted}`}>
        {t("settings.toolsRulesPauseHint")}
      </p>

      {/* F2：仅当前会话暂停（其它会话/后台任务不受影响） */}
      <div className={`flex items-center gap-2 rounded px-3 py-1.5 ${rowBg}`}>
        <label className="flex items-center gap-2 text-xs flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={
              !!currentSessionId &&
              (pause?.sessions ?? []).includes(currentSessionId)
            }
            disabled={!pause || !currentSessionId || busy}
            onChange={onToggleSession}
          />
          <span>{t("settings.toolsRulesPauseSessionLabel")}</span>
          {!currentSessionId && (
            <span className={`text-[10px] ${muted}`}>
              {t("settings.toolsRulesPauseSessionNoSession")}
            </span>
          )}
        </label>
        <span className={`text-[10px] ${muted}`}>
          {t("settings.toolsRulesPauseSessionCount", {
            count: pause?.sessions?.length ?? 0,
          })}
        </span>
      </div>
      <p className={`text-[11px] ${muted}`}>
        {t("settings.toolsRulesPauseSessionHint")}
      </p>

      {/* F2：按工作区暂停（只影响该根下的调用；已暂停的根可在此逐个移除） */}
      {pause && (
        <>
          <div
            className={`flex items-center gap-2 rounded px-3 py-1.5 ${rowBg}`}
          >
            <label className="flex items-center gap-2 text-xs flex-1 cursor-pointer">
              <input
                type="checkbox"
                checked={currentWorkspacePaused}
                disabled={!currentWorkspacePath || busy}
                onChange={onToggleWorkspace}
              />
              <span>{t("settings.toolsRulesPauseWorkspaceLabel")}</span>
              {!currentWorkspacePath && (
                <span className={`text-[10px] ${muted}`}>
                  {t("settings.toolsRulesPauseWorkspaceNoPath")}
                </span>
              )}
            </label>
            <span className={`text-[10px] ${muted}`}>
              {t("settings.toolsRulesPauseWorkspaceCount", {
                count: pausedWorkspaceRoots.length,
              })}
            </span>
          </div>
          <p className={`text-[11px] ${muted}`}>
            {t("settings.toolsRulesPauseWorkspaceHint")}
          </p>
          {pausedWorkspaceRoots.length > 0 && (
            <div className="space-y-1">
              {pausedWorkspaceRoots.map((root) => (
                <div
                  key={root}
                  className={`flex items-center gap-2 px-3 py-1 rounded text-[11px] ${rowBg}`}
                >
                  <code className="break-all flex-1">{root}</code>
                  <button
                    type="button"
                    onClick={() =>
                      onSetWorkspaces(
                        pausedWorkspaceRoots.filter((item) => item !== root),
                      )
                    }
                    disabled={busy}
                    className="text-red-400 hover:text-red-600 shrink-0 disabled:opacity-50"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
