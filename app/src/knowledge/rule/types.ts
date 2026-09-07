// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * K3 规则类知识 — 类型定义
 *
 * 规则是文档中提取出的规范性陈述（必须/应/可…），区别于实体关系与业务记录。
 * constraintStrength 语义（对齐 spec：🔴必须 / 🟡应 / 🔵可）：
 *   - mandatory（必须/严禁/禁止/不得）→ 强制
 *   - should（应当/宜/建议）→ 推荐
 *   - may（可以/允许）→ 可选
 */

/** 规则类别 */
export type RuleKind = 'policy' | 'guideline' | 'tip';

/** 约束强度（强制级别） */
export type ConstraintStrength = 'mandatory' | 'should' | 'may';

/** 规则的三个强度级别（顺序即强度从高到低） */
export const CONSTRAINT_STRENGTH_ORDER: ConstraintStrength[] = [
  'mandatory',
  'should',
  'may',
];

/** 允许的规则类别全集（无 rules.yaml 白名单时的默认允许集） */
export const DEFAULT_RULE_KINDS: RuleKind[] = ['policy', 'guideline', 'tip'];

/** 单条规则（抽取/存储统一结构） */
export interface RuleRecord {
  /** 规则 ID：{kind}:{statementHash} */
  id: string;
  /** 类别 */
  kind: RuleKind;
  /** 规则陈述（完整一句话） */
  statement: string;
  /** 触发场景/适用动作（如 ["签订合同","对外披露"]） */
  triggers: string[];
  /** 约束强度 */
  constraintStrength: ConstraintStrength;
  /** 适用范围（可选，如 "采购部"、"IPO 材料"） */
  appliesTo?: string[];
  /** 冲突指向的其它规则 ID（成对声明，未配对会在校验阶段报 warning） */
  conflictOf: string[];
  /** 证据：{statement: "原文摘句", trigger?: ...} */
  evidence: Record<string, string>;
  /** 来源编译页面文件路径 */
  sourceFile: string;
  /** 所属域（默认 knowledge） */
  domain: string;
  createdAt: number;
  updatedAt: number;
}
