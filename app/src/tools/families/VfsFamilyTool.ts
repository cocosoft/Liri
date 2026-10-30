/**
 * vfs 族（P1，2026-10-30）：`read_vfs` / `list_vfs` / `stat_vfs` / `write_vfs` → `vfs`（`op` 分派）
 *
 * 同一资源（AI-VFS 挂载命名空间）、同一权限族 ⇒ 合并为一个带 `op` 的系统调用入口；
 * 旧名保留为 alias，行为与出参逐字沿用原实现（本层只分派，不重写）。
 *
 * ⚠️ 注册仍沿用 D7 门控口径：整族由 `VFS_ENABLED` 控制（`stat` 的"无条件注册"在合并后
 * 不再单独成立 —— 一个工具无法只注册其中一个 op；这是合并的**已知代价**，回退即拆回四件）。
 */
import { TOOL_NAME_CONSTANTS } from '../../constants/toolNameConstants';
import { ReadVfsTool } from '../ReadVfsTool/ReadVfsTool';
import { ListVfsTool } from '../ListVfsTool/ListVfsTool';
import { StatVfsTool } from '../StatVfsTool/StatVfsTool';
import { WriteVfsTool } from '../WriteVfsTool/WriteVfsTool';
import { FamilyTool } from './familyTool';

export function createVfsFamilyTool(): FamilyTool {
  return new FamilyTool({
    name: TOOL_NAME_CONSTANTS.vfs,
    description:
      'AI-VFS 统一命名空间入口（op 分派）：路径形如 <scheme>://<authority>[/<path>]（如 dev_docs://配置与安全/sandbox.md）。' +
      'op="read" 读文件内容（可按行分片）；op="list" 列举目录（<scheme>:// 形式列举该 scheme 的挂载点）；' +
      'op="stat" 查元数据（kind/size/mtime/mount/readOnly）；op="write" 写文件（只读挂载会明确拒绝）。' +
      '未注册的 scheme 一律明确失败，不回退本地文件系统。',
    discriminator: 'op',
    discriminatorDescription:
      '操作：read（读）| list（列目录）| stat（元数据）| write（写）',
    searchTips: ['vfs', 'virtual filesystem', 'mount', 'mcp resources'],
    params: [
      {
        name: 'path',
        type: 'string',
        description:
          'VFS 路径：<scheme>://<authority>[/<path>]（op=read/list/stat/write 均需要）',
        required: false,
      },
      {
        name: 'offset',
        type: 'number',
        description: 'op=read：起始行（0 起，可选）',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'op=read/list：最多返回的行数/条目数（可选）',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'op=list：是否递归列举子目录（默认 false）',
        required: false,
        default: false,
      },
      {
        name: 'content',
        type: 'string',
        description: 'op=write：写入的文本内容',
        required: false,
      },
      {
        name: 'mode',
        type: 'string',
        description:
          'op=write：写入模式 create | overwrite | append（默认 create）',
        required: false,
        enum: ['create', 'overwrite', 'append'],
        default: 'create',
      },
    ],
    members: [
      {
        key: 'read',
        legacyName: TOOL_NAME_CONSTANTS.read_vfs,
        required: ['path'],
        readOnly: true,
        create: () => ReadVfsTool.create(),
      },
      {
        key: 'list',
        legacyName: TOOL_NAME_CONSTANTS.list_vfs,
        required: ['path'],
        readOnly: true,
        create: () => ListVfsTool.create(),
      },
      {
        key: 'stat',
        legacyName: TOOL_NAME_CONSTANTS.stat_vfs,
        required: ['path'],
        readOnly: true,
        create: () => StatVfsTool.create(),
      },
      {
        key: 'write',
        legacyName: TOOL_NAME_CONSTANTS.write_vfs,
        required: ['path'],
        readOnly: false,
        destructive: true,
        create: () => WriteVfsTool.create(),
      },
    ],
    // ⚠️ read / stat 的旧入参形态完全相同（只有 path）⇒ **不做**形态推断（会产生静默误判），
    // 旧名调用依赖执行入口的 `aliasInputDefaults` 补 op；缺少 op 时明确报错让模型自纠。
    inferKey: (input) => {
      if (typeof input['content'] === 'string') return 'write';
      if (typeof input['recursive'] === 'boolean') return 'list';
      return undefined;
    },
  });
}
