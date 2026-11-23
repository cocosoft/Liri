// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `@openliri/tool-workspace` 公共出口 —— 工作区 / 文件系统域。
 *
 * - `enter_worktree` / `exit_worktree`：Git worktree 进出；
 * - `create_project` / `read_project_file` / `write_project_file`：项目与项目文件；
 * - `read_vfs` / `write_vfs` / `list_vfs` / `stat_vfs`：VFS 挂载点读写；
 * - `families/`：vfs / worktree 两个同资源族工具。
 *
 * 注册动作（`builtinToolRegistry`）仍在 app：本包只提供工具实现。
 */

export { EnterWorktreeTool } from './EnterWorktreeTool/EnterWorktreeTool';
export { EnterWorktreeOutputSchema } from './EnterWorktreeTool/schemas';
export { ExitWorktreeTool } from './ExitWorktreeTool/ExitWorktreeTool';
export { ExitWorktreeOutputSchema } from './ExitWorktreeTool/schemas';
export { CreateProjectTool } from './CreateProjectTool/CreateProjectTool';
export { resolveProjectIdentity } from './CreateProjectTool/projectName';
export {
  ReadProjectFileTool,
  resetReadProjectFileStoresForTest,
} from './ReadProjectFileTool/ReadProjectFileTool';
export { WriteProjectFileTool } from './WriteProjectFileTool/WriteProjectFileTool';
export { ReadVfsTool } from './ReadVfsTool/ReadVfsTool';
export { WriteVfsTool } from './WriteVfsTool/WriteVfsTool';
export { ListVfsTool } from './ListVfsTool/ListVfsTool';
export { StatVfsTool } from './StatVfsTool/StatVfsTool';
export { createVfsFamilyTool } from './families/VfsFamilyTool';
export { createWorktreeFamilyTool } from './families/WorktreeFamilyTool';
