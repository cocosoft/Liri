/**
 * types.ts — 人设核心类型定义
 *
 * 包含人设绑定关系的持久化数据模型。
 */

/**
 * PersonaBinding — Agent 与人设的绑定关系记录
 *
 * 对应数据库 persona_bindings 表。
 * 同一 Agent 只能绑定一个人设，新绑定会覆盖旧绑定。
 */
export interface PersonaBinding {
  /** 唯一标识，自增主键 */
  id: number;

  /** Agent ID */
  agentId: string;

  /** 人设 ID（对应 TTSPersona.id） */
  personaId: string;

  /** 创建时间戳（Unix 秒） */
  createdAt: number;

  /** 更新时间戳（Unix 秒） */
  updatedAt: number;
}

/**
 * CreatePersonaBindingInput — 创建绑定关系的输入参数
 */
export interface CreatePersonaBindingInput {
  agentId: string;
  personaId: string;
}
