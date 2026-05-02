/**
 * 通知服务
 *
 * 提供跨平台桌面通知功能。
 * 支持频道配置（auto/iterm2/terminal_bell/notifications_disabled）。
 * 使用 child_process 调用系统原生通知命令。
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { platform } from 'os'

const execAsync = promisify(exec)

/**
 * 通知选项
 */
export interface NotificationOptions {
  message: string
  title?: string
  notificationType?: string
}

/**
 * 通知结果
 */
export interface NotificationResult {
  channel: string
  success: boolean
}

const DEFAULT_TITLE = 'PY_APP'
const DEFAULT_CHANNEL = 'auto'
const BELL_CHAR = '\x07'

/**
 * 发送系统通知
 *
 * 根据配置的频道选择通知方式：
 * - auto: 自动选择平台原生通知
 * - terminal_bell: 仅终端响铃
 * - notifications_disabled: 不发送
 * - 其他: 自动降级
 *
 * @param notif - 通知选项
 * @returns 使用的频道和方法
 */
export async function sendNotification(
  notif: NotificationOptions
): Promise<NotificationResult> {
  const channel = process.env.PY_APP_NOTIFICATION_CHANNEL || DEFAULT_CHANNEL

  if (channel === 'notifications_disabled') {
    return { channel: 'notifications_disabled', success: true }
  }

  if (channel === 'terminal_bell') {
    process.stdout.write(BELL_CHAR)
    return { channel: 'terminal_bell', success: true }
  }

  if (channel === 'auto') {
    return sendAutoNotification(notif)
  }

  return sendAutoNotification(notif)
}

/**
 * 发送终端响铃通知
 */
export function sendTerminalBell(): void {
  process.stdout.write(BELL_CHAR)
}

/**
 * 自动选择平台原生通知方式
 */
async function sendAutoNotification(
  opts: NotificationOptions
): Promise<NotificationResult> {
  const title = opts.title || DEFAULT_TITLE
  const body = opts.message

  try {
    const plat = platform()

    if (plat === 'win32') {
      return sendWindowsNotification(title, body)
    }

    if (plat === 'darwin') {
      return sendMacNotification(title, body)
    }

    return sendLinuxNotification(title, body)
  } catch {
    process.stdout.write(BELL_CHAR)
    return { channel: 'terminal_bell', success: false }
  }
}

/**
 * 发送 Windows toast 通知（通过 PowerShell）
 */
async function sendWindowsNotification(
  title: string,
  body: string
): Promise<NotificationResult> {
  try {
    const escapedTitle = title.replace(/'/g, "''")
    const escapedBody = body.replace(/'/g, "''")
    const script = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $textNodes = $template.GetElementsByTagName("text")
      $textNodes.Item(0).AppendChild($template.CreateTextNode('${escapedTitle}')) > $null
      $textNodes.Item(1).AppendChild($template.CreateTextNode('${escapedBody}')) > $null
      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier().Show($toast)
    `
    await execAsync(
      `powershell -NoProfile -Command "${script.replace(/\n/g, ' ')}"`,
      { timeout: 5000 }
    )
    return { channel: 'auto', success: true }
  } catch {
    try {
      const escapedTitle = title.replace(/"/g, '\\"')
      const escapedBody = body.replace(/"/g, '\\"')
      const command = `powershell -NoProfile -Command "New-BurntToastNotification -Text '${escapedTitle}', '${escapedBody}'"`
      await execAsync(command, { timeout: 5000 })
      return { channel: 'auto', success: true }
    } catch {
      process.stdout.write(BELL_CHAR)
      return { channel: 'terminal_bell', success: false }
    }
  }
}

/**
 * 发送 macOS 通知（通过 osascript）
 */
async function sendMacNotification(
  title: string,
  body: string
): Promise<NotificationResult> {
  const escapedTitle = title.replace(/"/g, '\\"')
  const escapedBody = body.replace(/"/g, '\\"')
  await execAsync(
    `osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`,
    { timeout: 5000 }
  )
  return { channel: 'auto', success: true }
}

/**
 * 发送 Linux 通知（通过 notify-send）
 */
async function sendLinuxNotification(
  title: string,
  body: string
): Promise<NotificationResult> {
  await execAsync(
    `notify-send "${title.replace(/"/g, '\\"')}" "${body.replace(/"/g, '\\"')}"`,
    { timeout: 5000 }
  )
  return { channel: 'auto', success: true }
}

/**
 * 发送任务完成通知
 *
 * @param taskName - 任务名称
 * @param result - 任务结果（成功/失败）
 * @param details - 可选详情
 */
export async function sendTaskNotification(
  taskName: string,
  result: 'success' | 'failure',
  details?: string
): Promise<NotificationResult> {
  const title = `Task ${result === 'success' ? 'Completed' : 'Failed'}: ${taskName}`
  const body = details || `Task "${taskName}" has ${result === 'success' ? 'completed successfully' : 'failed'}.`

  return sendNotification({ message: body, title })
}
