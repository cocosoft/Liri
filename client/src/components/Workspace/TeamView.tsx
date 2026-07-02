/**
 * 团队管理视图
 *
 * 管理团队 CRUD、成员增减、角色分配
 */
import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { workspaceService } from "@/services/workspaceService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:teamView");

interface TeamMember {
  id: string;
  name: string;
  role: string;
  joinedAt: string;
  isAgent?: boolean;
  model?: string;
}

interface Team {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

const ROLE_LABELS: Record<string, string> = {
  owner: "拥有者",
  admin: "管理员",
  member: "成员",
  viewer: "观察者",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-red-100 text-red-800",
  admin: "bg-orange-100 text-orange-800",
  member: "bg-blue-100 text-blue-800",
  viewer: "bg-gray-100 text-gray-800",
};

export const TeamView: React.FC = () => {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id || "";

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDesc, setNewTeamDesc] = useState("");
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [newMemberIsAgent, setNewMemberIsAgent] = useState(false);

  /** 加载团队列表 */
  const loadTeams = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await workspaceService.getTeams(workspaceId) as Team[];
      setTeams(data);
    } catch (err) {
      logger.error("加载团队列表失败:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  /** 创建团队 */
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    try {
      await workspaceService.createTeam(workspaceId, {
        name: newTeamName.trim(),
        description: newTeamDesc.trim(),
      });
      setNewTeamName("");
      setNewTeamDesc("");
      setShowCreate(false);
      loadTeams();
    } catch (err) {
      logger.error("创建团队失败:", err);
    }
  };

  /** 删除团队 */
  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm("确定要删除这个团队吗？")) return;
    try {
      await workspaceService.deleteTeam(workspaceId, teamId);
      if (selectedTeam?.id === teamId) setSelectedTeam(null);
      loadTeams();
    } catch (err) {
      logger.error("删除团队失败:", err);
    }
  };

  /** 添加成员 */
  const handleAddMember = async () => {
    if (!selectedTeam || !newMemberId.trim() || !newMemberName.trim()) return;
    try {
      await workspaceService.addTeamMember(workspaceId, selectedTeam.id, {
        id: newMemberId.trim(),
        name: newMemberName.trim(),
        role: newMemberRole,
        isAgent: newMemberIsAgent,
      });
      setNewMemberId("");
      setNewMemberName("");
      setNewMemberRole("member");
      setNewMemberIsAgent(false);
      setShowAddMember(false);
      loadTeams();
    } catch (err) {
      logger.error("添加成员失败:", err);
    }
  };

  /** 移除成员 */
  const handleRemoveMember = async (teamId: string, memberId: string) => {
    if (!confirm("确定要移除该成员吗？")) return;
    try {
      await workspaceService.removeTeamMember(workspaceId, teamId, memberId);
      loadTeams();
    } catch (err) {
      logger.error("移除成员失败:", err);
    }
  };

  /** 更新成员角色 */
  const handleRoleChange = async (teamId: string, memberId: string, newRole: string) => {
    try {
      await workspaceService.updateMemberRole(workspaceId, teamId, memberId, newRole);
      loadTeams();
    } catch (err) {
      logger.error("更新角色失败:", err);
    }
  };

  if (!workspaceId) {
    return <div className="p-4 text-gray-500">{t("workspace.members")}</div>;
  }

  return (
    <div className="flex h-full">
      {/* 团队列表 */}
      <div className="w-64 border-r border-gray-200 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">{t("workspace.members")}</h3>
          <button
            onClick={() => setShowCreate(true)}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            + 新建
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">加载中...</div>
        ) : teams.length === 0 ? (
          <div className="text-sm text-gray-400">暂无团队</div>
        ) : (
          <ul className="space-y-1">
            {teams.map((team) => (
              <li
                key={team.id}
                onClick={() => setSelectedTeam(team)}
                className={`p-2 rounded cursor-pointer text-sm ${
                  selectedTeam?.id === team.id
                    ? "bg-blue-50 text-blue-700"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
              >
                <div className="font-medium truncate">{team.name}</div>
                <div className="text-xs text-gray-400">
                  {team.members.length} {t("workspace.members")}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 创建团队弹窗 */}
        {showCreate && (
          <div className="mt-3 p-3 bg-gray-50 rounded border">
            <input
              className="w-full border px-2 py-1 text-sm rounded mb-2"
              placeholder="团队名称"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
            />
            <input
              className="w-full border px-2 py-1 text-sm rounded mb-2"
              placeholder="描述（可选）"
              value={newTeamDesc}
              onChange={(e) => setNewTeamDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateTeam}
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                创建
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1 text-xs bg-gray-300 rounded hover:bg-gray-400"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 团队详情 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {selectedTeam ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{selectedTeam.name}</h2>
                {selectedTeam.description && (
                  <p className="text-sm text-gray-500 mt-1">{selectedTeam.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddMember(true)}
                  className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                >
                  + 添加成员
                </button>
                <button
                  onClick={() => handleDeleteTeam(selectedTeam.id)}
                  className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                >
                  删除团队
                </button>
              </div>
            </div>

            {/* 标签 */}
            {selectedTeam.tags && selectedTeam.tags.length > 0 && (
              <div className="flex gap-1 mb-4">
                {selectedTeam.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 成员列表 */}
            <h3 className="font-medium text-gray-700 mb-2">
              成员 ({selectedTeam.members.length})
            </h3>
            <div className="space-y-2">
              {selectedTeam.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{member.name}</span>
                    {member.isAgent && (
                      <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                        Agent
                      </span>
                    )}
                    {member.model && (
                      <span className="text-xs text-gray-400">{member.model}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(selectedTeam.id, member.id, e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded ${ROLE_COLORS[member.role] || ""}`}
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{t(label)}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleRemoveMember(selectedTeam.id, member.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 添加成员弹窗 */}
            {showAddMember && (
              <div className="mt-4 p-4 bg-gray-50 rounded border">
                <h4 className="font-medium mb-3 text-sm">添加成员</h4>
                <div className="space-y-2">
                  <input
                    className="w-full border px-2 py-1 text-sm rounded"
                    placeholder="成员 ID"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                  />
                  <input
                    className="w-full border px-2 py-1 text-sm rounded"
                    placeholder="成员名称"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                  />
                  <select
                    className="w-full border px-2 py-1 text-sm rounded"
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value)}
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newMemberIsAgent}
                      onChange={(e) => setNewMemberIsAgent(e.target.checked)}
                    />
                    Agent 成员
                  </label>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleAddMember}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    添加
                  </button>
                  <button
                    onClick={() => setShowAddMember(false)}
                    className="px-3 py-1 text-xs bg-gray-300 rounded hover:bg-gray-400"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-gray-400 text-center mt-20">
            {t("workspace.detail")}
          </div>
        )}
      </div>
    </div>
  );
};