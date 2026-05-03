import { PassesService } from '../../../analytics/PassesService.js'

export interface PassesCommandOutput {
  header: string
  lines: string[]
}

export function passesStatusCommand(service?: PassesService): PassesCommandOutput {
  const passesService = service || new PassesService()
  const balances = passesService.getActiveBalances()

  const lines: string[] = []

  if (balances.length === 0) {
    return { header: 'No active passes', lines: ['No passes are currently active.'] }
  }

  for (const balance of balances) {
    const timeLeft = Math.max(0, balance.periodEnd - Date.now())
    const hoursLeft = (timeLeft / 3600000).toFixed(1)
    const daysLeft = (timeLeft / 86400000).toFixed(1)

    lines.push(`${balance.passName}:`)
    lines.push(`  ${progressBar(balance.tokens.percentUsed)} ${balance.tokens.used.toLocaleString()}/${balance.tokens.budget.toLocaleString()} tokens (${(balance.tokens.percentUsed * 100).toFixed(1)}%)`)
    lines.push(`  ${progressBar(balance.messages.percentUsed)} ${balance.messages.used}/${balance.messages.budget} messages (${(balance.messages.percentUsed * 100).toFixed(1)}%)`)
    lines.push(`  ${progressBar(balance.tools.percentUsed)} ${balance.tools.used}/${balance.tools.budget} tools (${(balance.tools.percentUsed * 100).toFixed(1)}%)`)
    lines.push(`  ${progressBar(balance.cost.percentUsed)} $${balance.cost.usedUSD.toFixed(2)}/$${balance.cost.budgetUSD.toFixed(2)} cost (${(balance.cost.percentUsed * 100).toFixed(1)}%)`)
    lines.push(`  Resets in: ${parseFloat(daysLeft) > 1 ? daysLeft + ' days' : hoursLeft + ' hours'}`)
    lines.push('')
  }

  const { over, passes: overPasses } = passesService.isOverQuota()
  if (over) {
    lines.push('⚠ WARNINGS:')
    for (const msg of overPasses) {
      lines.push(`  - ${msg}`)
    }
  }

  return {
    header: `Passes Status (${new Date().toLocaleString()})`,
    lines,
  }
}

export function passesResetCommand(service?: PassesService): string {
  const passesService = service || new PassesService()
  passesService.resetPeriod()
  return 'Passes period has been reset.'
}

function progressBar(ratio: number, width: number = 20): string {
  const filled = Math.round(ratio * width)
  const empty = width - filled

  let bar = ''
  if (ratio >= 0.9) {
    bar = '█'.repeat(filled) + '░'.repeat(empty)
    return `[red]${bar}[/red]`
  }
  if (ratio >= 0.7) {
    bar = '█'.repeat(filled) + '░'.repeat(empty)
    return `[yellow]${bar}[/yellow]`
  }
  bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[green]${bar}[/green]`
}

export function getPassesSummary(service?: PassesService): string {
  const passesService = service || new PassesService()
  return passesService.getUsageSummary()
}
