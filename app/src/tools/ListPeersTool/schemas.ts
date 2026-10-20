import { z } from 'zod';

/**
 * ListPeersTool 输入模式
 */
export const ListPeersInputSchema = z.strictObject({
  type: z
    .string()
    .optional()
    .describe(
      'Peer 类型过滤：uds（本地 socket）、bridge（远程会话）、local（本地进程）'
    ),
});

/**
 * Peer 信息模式
 */
export const PeerInfoSchema = z.object({
  id: z.string().describe('Peer 唯一标识'),
  type: z.enum(['uds', 'bridge', 'local']).describe('Peer 类型'),
  address: z.string().describe('Peer 地址'),
  status: z.enum(['active', 'inactive']).describe('Peer 状态'),
  lastSeen: z.string().optional().describe('最后活跃时间'),
});

/**
 * ListPeersTool 输出模式
 */
export const ListPeersOutputSchema = z.object({
  peers: z.array(PeerInfoSchema).describe('Peer 信息列表'),
  total: z.number().describe('Peer 总数'),
  active: z.number().describe('活跃 Peer 数'),
});

export type ListPeersInput = z.infer<typeof ListPeersInputSchema>;
export type ListPeersOutput = z.infer<typeof ListPeersOutputSchema>;

/**
 * U-03（2026-10-19）：`list_peers` 的**模型可见出参结构**（JSON Schema），
 * 与 `ListPeersOutputSchema` / `PeerInfoSchema` 逐字段对齐。
 */
export const ListPeersOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    peers: {
      type: 'array',
      description: 'Peer 信息列表',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Peer 唯一标识' },
          type: {
            type: 'string',
            enum: ['uds', 'bridge', 'local'],
            description: 'Peer 类型',
          },
          address: { type: 'string', description: 'Peer 地址' },
          status: {
            type: 'string',
            enum: ['active', 'inactive'],
            description: 'Peer 状态',
          },
          lastSeen: { type: 'string', description: '最后活跃时间' },
        },
        required: ['id', 'type', 'address', 'status'],
      },
    },
    total: { type: 'number', description: 'Peer 总数' },
    active: { type: 'number', description: '活跃 Peer 数' },
  },
  required: ['peers', 'total', 'active'],
};

/**
 * 验证 ListPeersTool 输入
 */
export function validateListPeersInput(input: unknown) {
  const result = ListPeersInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      success: false as const,
      error: `ListPeersTool 输入验证失败: ${issues.join('; ')}`,
    };
  }
  return { success: true as const, data: result.data };
}
