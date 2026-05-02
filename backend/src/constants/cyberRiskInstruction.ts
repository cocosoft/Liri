/**
 * 安全风险指令常量
 * 基于CC源码 cc_code/backend/constants/cyberRiskInstruction.ts 实现
 * 定义Claude处理安全相关请求时的行为边界
 *
 * 重要：未经安全团队审查，请勿修改此指令
 */

/**
 * 安全风险指令
 * 定义可接受的防御性安全协助与潜在有害活动之间的边界
 */
export const CYBER_RISK_INSTRUCTION = `IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`;
