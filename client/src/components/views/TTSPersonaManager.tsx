import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TTSPersonaEditor } from "./TTSPersonaEditor";
import { getBackendBaseUrl } from "../../services/backendUrl";

/**
 * TTS 人设管理模块
 *
 * 提供人设的列表展示、创建、编辑、删除功能。
 * 支持默认人设标记、Agent 绑定信息展示。
 * 初始化时调用 GET /v1/tts/personas 获取人设列表。
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

/** Agent 绑定信息 */
interface AgentBinding {
  agentId: string;
  agentName: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface PersonaBindings {
  personaId: string;
  agents: AgentBinding[];
}

export function TTSPersonaManager() {
  const [personas, setPersonas] = useState<TTSPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<TTSPersona | null>(null);
  const [defaultPersonaId, setDefaultPersonaId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, AgentBinding[]>>({});
  const [settingDefault, setSettingDefault] = useState<string | null>(null);

  /** 加载人设列表 */
  const loadPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setPersonas(data);
      }
    } catch {
      // 后端未就绪时保持空列表
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载默认人设 */
  const loadDefaultPersona = useCallback(async () => {
    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas/default`);
      if (response.ok) {
        const data = await response.json();
        setDefaultPersonaId(data.id || null);
      }
    } catch {
      // 后端尚未实现时保持 null
    }
  }, []);

  /** 加载 Agent 绑定信息 */
  const loadBindings = useCallback(async () => {
    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas/bindings`);
      if (response.ok) {
        const data: PersonaBindings[] = await response.json();
        const map: Record<string, AgentBinding[]> = {};
        for (const b of data) {
          map[b.personaId] = b.agents;
        }
        setBindings(map);
      }
    } catch {
      // 后端尚未实现时保持空
    }
  }, []);

  useEffect(() => {
    loadPersonas();
    loadDefaultPersona();
    loadBindings();
  }, [loadPersonas, loadDefaultPersona, loadBindings]);

  /** 打开新建弹窗 */
  const handleCreate = () => {
    setEditingPersona(null);
    setEditorOpen(true);
  };

  /** 打开编辑弹窗 */
  const handleEdit = (persona: TTSPersona) => {
    setEditingPersona(persona);
    setEditorOpen(true);
  };

  /** 删除人设 */
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("删除人设失败");
      await loadPersonas();
      await loadDefaultPersona();
    } catch {
      // 静默降级
    }
  };

  /** 设为默认人设 */
  const handleSetDefault = async (id: string) => {
    setSettingDefault(id);
    try {
      const response = await fetch(`${getBackendBaseUrl()}/v1/tts/personas/${id}/default`, {
        method: "PUT",
      });
      if (response.ok) {
        setDefaultPersonaId(id);
      }
    } catch {
      // 静默降级
    } finally {
      setSettingDefault(null);
    }
  };

  return (
    <>
      <Card size="sm" className="mb-6">
        <CardHeader>
          <CardTitle>人设管理</CardTitle>
          <p className="text-sm text-muted-foreground">
            管理语音合成人设，快速切换不同的语音风格
          </p>
        </CardHeader>
        <CardContent>
          {/* 新建按钮 */}
          <div className="mb-4">
            <Button
              variant="outline"
              onClick={handleCreate}
              size="sm"
            >
              + 新建人设
            </Button>
          </div>

          {/* 加载中 */}
          {loading && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              加载中...
            </div>
          )}

          {/* 空状态 */}
          {!loading && personas.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              暂无保存的人设，点击"新建人设"开始创建
            </div>
          )}

          {/* 人设列表 */}
          {!loading && personas.length > 0 && (
            <div className="space-y-2">
              {personas.map((persona) => {
                const isDefault = persona.id === defaultPersonaId;
                const agentBindings = bindings[persona.id];

                return (
                  <div
                    key={persona.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {persona.name}
                        </p>
                        {/* 默认标记 */}
                        {isDefault && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200">
                            ★ 默认
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {persona.description ?? "无描述"}
                        {" · "}
                        {persona.provider} / {persona.voice}
                        {persona.format ? ` / ${persona.format}` : ""}
                      </p>
                      {/* Agent 绑定信息 */}
                      {agentBindings && agentBindings.length > 0 && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                          已绑定 {agentBindings.length} 个 Agent：
                          {agentBindings.map((a) => a.agentName).join("、")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* 设为默认（非当前默认时显示） */}
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleSetDefault(persona.id)}
                          disabled={settingDefault === persona.id}
                          title="设为默认"
                        >
                          {settingDefault === persona.id ? "..." : "设为默认"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleEdit(persona)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => handleDelete(persona.id)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 人设编辑器弹窗 */}
      <TTSPersonaEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        persona={editingPersona}
        onSaved={loadPersonas}
      />
    </>
  );
}
