import { DANGEROUS_BASE_COMMANDS } from '../patterns'

export type CommandCategory = 'safe' | 'dangerous' | 'needs-confirmation' | 'unknown'

export type CommandEntry = {
  name: string
  category: CommandCategory
  description: string
  subcommands?: CommandEntry[]
  options?: string[]
}

const KNOWN_COMMANDS: Map<string, CommandEntry> = new Map()

const BUILTIN_COMMANDS: CommandEntry[] = [
  { name: 'ls', category: 'safe', description: '列出目录内容' },
  { name: 'cat', category: 'safe', description: '显示文件内容' },
  { name: 'echo', category: 'safe', description: '输出文本' },
  { name: 'pwd', category: 'safe', description: '显示当前工作目录' },
  { name: 'cd', category: 'safe', description: '切换目录' },
  { name: 'mkdir', category: 'safe', description: '创建目录' },
  { name: 'rmdir', category: 'safe', description: '删除空目录' },
  { name: 'cp', category: 'safe', description: '复制文件' },
  { name: 'mv', category: 'safe', description: '移动/重命名文件' },
  { name: 'touch', category: 'safe', description: '创建空文件或更新时间戳' },
  { name: 'find', category: 'safe', description: '搜索文件' },
  { name: 'grep', category: 'safe', description: '文本搜索' },
  { name: 'head', category: 'safe', description: '显示文件开头' },
  { name: 'tail', category: 'safe', description: '显示文件结尾' },
  { name: 'wc', category: 'safe', description: '统计行数/词数/字符数' },
  { name: 'sort', category: 'safe', description: '排序' },
  { name: 'uniq', category: 'safe', description: '去重' },
  { name: 'cut', category: 'safe', description: '文本列提取' },
  { name: 'tr', category: 'safe', description: '字符替换' },
  { name: 'sed', category: 'safe', description: '流编辑器' },
  { name: 'awk', category: 'safe', description: '文本处理语言' },
  { name: 'diff', category: 'safe', description: '文件比较' },
  { name: 'file', category: 'safe', description: '识别文件类型' },
  { name: 'du', category: 'safe', description: '磁盘使用统计' },
  { name: 'df', category: 'safe', description: '磁盘空间信息' },
  { name: 'ps', category: 'safe', description: '进程状态' },
  { name: 'which', category: 'safe', description: '查找命令路径' },
  { name: 'type', category: 'safe', description: '显示命令类型' },
  { name: 'env', category: 'safe', description: '显示环境变量' },
  { name: 'printenv', category: 'safe', description: '打印环境变量' },
  { name: 'date', category: 'safe', description: '显示/设置日期' },
  { name: 'uname', category: 'safe', description: '系统信息' },
  { name: 'hostname', category: 'safe', description: '主机名' },
  { name: 'whoami', category: 'safe', description: '当前用户名' },
  { name: 'id', category: 'safe', description: '用户/组信息' },
  { name: 'groups', category: 'safe', description: '组信息' },
  { name: 'man', category: 'safe', description: '帮助手册' },
  { name: 'help', category: 'safe', description: '命令帮助' },
  { name: 'alias', category: 'safe', description: '命令别名' },
  { name: 'history', category: 'safe', description: '命令历史' },
  { name: 'exit', category: 'safe', description: '退出Shell' },
  { name: 'clear', category: 'safe', description: '清屏' },
  { name: 'less', category: 'safe', description: '分页查看' },
  { name: 'more', category: 'safe', description: '分页查看' },
  { name: 'tee', category: 'safe', description: '分流输出' },
  { name: 'xargs', category: 'safe', description: '参数转换' },
  { name: 'basename', category: 'safe', description: '文件名提取' },
  { name: 'dirname', category: 'safe', description: '目录名提取' },
  { name: 'realpath', category: 'safe', description: '真实路径' },
  { name: 'readlink', category: 'safe', description: '符号链接目标' },
  { name: 'stat', category: 'safe', description: '文件状态' },
  { name: 'sha256sum', category: 'safe', description: 'SHA256校验' },
  { name: 'md5sum', category: 'safe', description: 'MD5校验' },
  { name: 'tar', category: 'safe', description: '归档工具' },
  { name: 'gzip', category: 'safe', description: '压缩工具' },
  { name: 'gunzip', category: 'safe', description: '解压工具' },
  { name: 'zip', category: 'safe', description: 'ZIP压缩' },
  { name: 'unzip', category: 'safe', description: 'ZIP解压' },
  { name: 'python', category: 'needs-confirmation', description: 'Python解释器' },
  { name: 'python3', category: 'needs-confirmation', description: 'Python3解释器' },
  { name: 'node', category: 'needs-confirmation', description: 'Node.js运行环境' },
  { name: 'npm', category: 'needs-confirmation', description: 'NPM包管理器' },
  { name: 'npx', category: 'needs-confirmation', description: 'NPM包执行器' },
  { name: 'pip', category: 'needs-confirmation', description: 'Python包安装器' },
  { name: 'pip3', category: 'needs-confirmation', description: 'Python3包安装器' },
  { name: 'git', category: 'safe', description: '版本控制工具' },
  { name: 'docker', category: 'needs-confirmation', description: '容器管理' },
  { name: 'make', category: 'safe', description: '构建工具' },
  { name: 'cmake', category: 'safe', description: '构建工具' },
  { name: 'gcc', category: 'safe', description: 'C编译器' },
  { name: 'g++', category: 'safe', description: 'C++编译器' },
  { name: 'cargo', category: 'needs-confirmation', description: 'Rust构建/包管理' },
  { name: 'rustc', category: 'safe', description: 'Rust编译器' },
  { name: 'go', category: 'needs-confirmation', description: 'Go工具链' },
  { name: 'java', category: 'needs-confirmation', description: 'Java运行环境' },
  { name: 'javac', category: 'safe', description: 'Java编译器' },
  { name: 'bun', category: 'needs-confirmation', description: 'Bun运行时' },
  { name: 'tsc', category: 'safe', description: 'TypeScript编译器' },
  { name: 'nano', category: 'safe', description: '文本编辑器' },
  { name: 'vim', category: 'safe', description: '文本编辑器' },
  { name: 'curl', category: 'needs-confirmation', description: 'HTTP客户端' },
  { name: 'wget', category: 'needs-confirmation', description: 'HTTP下载工具' },
  { name: 'ssh', category: 'needs-confirmation', description: 'SSH客户端' },
  { name: 'scp', category: 'needs-confirmation', description: '安全文件拷贝' },
  { name: 'nc', category: 'needs-confirmation', description: '网络工具' },
  { name: 'ping', category: 'safe', description: '网络测试' },
  { name: 'traceroute', category: 'safe', description: '路由跟踪' },
  { name: 'dig', category: 'safe', description: 'DNS查询' },
  { name: 'nslookup', category: 'safe', description: 'DNS查询' },
  { name: 'ifconfig', category: 'safe', description: '网络接口配置' },
  { name: 'ip', category: 'safe', description: '网络管理' },
  { name: 'netstat', category: 'safe', description: '网络统计' },
  { name: 'ss', category: 'safe', description: 'Socket统计' },
  { name: 'systemctl', category: 'needs-confirmation', description: '系统服务管理' },
  { name: 'journalctl', category: 'safe', description: '系统日志' },
  { name: 'crontab', category: 'needs-confirmation', description: '计划任务' },
  { name: 'service', category: 'needs-confirmation', description: '服务管理' },
  { name: 'mount', category: 'needs-confirmation', description: '挂载文件系统' },
  { name: 'umount', category: 'needs-confirmation', description: '卸载文件系统' },
  { name: 'fdisk', category: 'needs-confirmation', description: '磁盘分区' },
  { name: 'kill', category: 'needs-confirmation', description: '终止进程' },
  { name: 'killall', category: 'needs-confirmation', description: '按名称终止进程' },
  { name: 'pkill', category: 'needs-confirmation', description: '按模式终止进程' },
  { name: 'reboot', category: 'needs-confirmation', description: '重启系统' },
  { name: 'shutdown', category: 'needs-confirmation', description: '关闭系统' },
  { name: 'su', category: 'needs-confirmation', description: '切换用户' },
]

for (const cmd of BUILTIN_COMMANDS) {
  KNOWN_COMMANDS.set(cmd.name, cmd)
}

export function classifyCommand(commandName: string): CommandCategory {
  if (!commandName) return 'unknown'

  const baseName = commandName.split(/[/\\]/).pop() || commandName

  if (DANGEROUS_BASE_COMMANDS.has(baseName)) {
    return 'dangerous'
  }

  const known = KNOWN_COMMANDS.get(baseName)
  if (known) {
    return known.category
  }

  if (baseName.startsWith('.')) {
    return 'needs-confirmation'
  }

  return 'unknown'
}

export function getCommandInfo(commandName: string): CommandEntry | null {
  const baseName = commandName.split(/[/\\]/).pop() || commandName
  return KNOWN_COMMANDS.get(baseName) || null
}

export function registerCommand(entry: CommandEntry): void {
  KNOWN_COMMANDS.set(entry.name, entry)
}

export function getAllCommands(): CommandEntry[] {
  return Array.from(KNOWN_COMMANDS.values())
}

export function getCommandsByCategory(category: CommandCategory): CommandEntry[] {
  return Array.from(KNOWN_COMMANDS.values()).filter(
    c => c.category === category,
  )
}
