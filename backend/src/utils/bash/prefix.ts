/**
 * Bash 命令前缀处理
 *
 * 解析和处理命令前缀（环境变量、包装命令等）。
 * 用于命令执行前的安全分析和前缀提取。
 */
import type { CommandSpec } from './registry'
import { parseCommand, extractCommandArguments } from './parser'
import { getCommandSpec, isWrapperCommand } from './registry'

const ENV_VAR = /^[A-Za-z_][A-Za-z0-9_]*=/
const NUMERIC = /^\d+$/

/**
 * 将值转为数组
 */
function toArray<T>(val: T | T[]): T[] {
  return Array.isArray(val) ? val : [val]
}

/**
 * 检查 args[0] 是否匹配已知子命令
 */
function isKnownSubcommand(
  arg: string,
  spec: { subcommands?: { name: string | string[] }[] } | null
): boolean {
  if (!spec?.subcommands?.length) return false
  return spec.subcommands.some(sub =>
    Array.isArray(sub.name) ? sub.name.includes(arg) : sub.name === arg
  )
}

/**
 * 获取命令前缀
 *
 * 解析命令字符串，提取安全和许可分析所需的前缀信息。
 * 处理方法：
 * - 环境变量赋值（KEY=VALUE）保留
 * - 包装命令（sudo、timeout 等）递归解析内部命令
 * - 普通命令提取顶层命令名
 *
 * @param command - 待解析的命令字符串
 * @param recursionDepth - 递归深度（防止循环）
 * @param wrapperCount - 包装命令嵌套计数
 * @returns 命令前缀信息，解析失败返回 null
 */
export async function getCommandPrefixStatic(
  command: string,
  recursionDepth = 0,
  wrapperCount = 0
): Promise<{ commandPrefix: string | null } | null> {
  if (wrapperCount > 2 || recursionDepth > 10) return null

  const parsed = await parseCommand(command)
  if (!parsed) return null

  if (!parsed.commandNode) {
    return { commandPrefix: null }
  }

  const { envVars, commandNode } = parsed
  const cmdArgs = extractCommandArguments(commandNode)
  const [cmd, ...args] = cmdArgs
  if (!cmd) return { commandPrefix: null }

  const spec = getCommandSpec(cmd)

  let isWrapper = isWrapperCommand(cmd) ||
    (spec?.args != null && toArray(spec.args).some(arg => arg?.isCommand))

  if (isWrapper && args[0] && isKnownSubcommand(args[0], spec)) {
    isWrapper = false
  }

  let prefix: string | null = null

  if (isWrapper) {
    prefix = await handleWrapper(cmd, args, recursionDepth, wrapperCount)
  } else {
    prefix = await buildPrefix(cmd, args, spec)
  }

  if (prefix === null && recursionDepth === 0 && isWrapper) {
    return null
  }

  const envPrefix = envVars.length ? `${envVars.join(' ')} ` : ''
  return { commandPrefix: prefix ? envPrefix + prefix : null }
}

/**
 * 处理包装命令（递归解析内部命令）
 */
async function handleWrapper(
  command: string,
  args: string[],
  recursionDepth: number,
  wrapperCount: number
): Promise<string | null> {
  const spec = getCommandSpec(command)

  if (spec?.args) {
    const commandArgIndex = toArray(spec.args).findIndex(arg => arg?.isCommand)
    if (commandArgIndex !== -1) {
      const parts = [command]
      for (let i = 0; i < args.length && i <= commandArgIndex; i++) {
        if (i === commandArgIndex) {
          const result = await getCommandPrefixStatic(
            args.slice(i).join(' '),
            recursionDepth + 1,
            wrapperCount + 1
          )
          if (result?.commandPrefix) {
            parts.push(...result.commandPrefix.split(' '))
            return parts.join(' ')
          }
          break
        } else if (
          args[i] &&
          !args[i].startsWith('-') &&
          !ENV_VAR.test(args[i])
        ) {
          parts.push(args[i])
        }
      }
    }
  }

  const wrapped = args.find(
    arg => !arg.startsWith('-') && !NUMERIC.test(arg) && !ENV_VAR.test(arg)
  )
  if (!wrapped) return command

  const wrappedIdx = args.indexOf(wrapped)
  const result = await getCommandPrefixStatic(
    args.slice(wrappedIdx).join(' '),
    recursionDepth + 1,
    wrapperCount + 1
  )

  return !result?.commandPrefix ? null : `${command} ${result.commandPrefix}`
}

/**
 * 构建普通命令的前缀
 */
async function buildPrefix(
  cmd: string,
  args: string[],
  spec: CommandSpec | null
): Promise<string | null> {
  // 如果命令有子命令且第一个参数匹配子命令，保留两者
  if (spec?.subcommands?.length && args.length > 0) {
    const sub = args[0]
    if (sub && !sub.startsWith('-') && !ENV_VAR.test(sub)) {
      if (spec.subcommands.some(s =>
        Array.isArray(s.name) ? s.name.includes(sub) : s.name === sub
      )) {
        return `${cmd} ${sub}`
      }
    }
  }

  return cmd
}
