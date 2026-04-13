import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PaymentIntent, Decision } from '../adapters/types.js'

export interface LogContext {
  dailySpentBefore: number
  dailySpentAfter: number
  monthlySpentBefore: number
  monthlySpentAfter: number
}

export interface LogEntry {
  ts: string
  agentId: string
  protocol: string
  amount: number
  currency: string
  merchant: string
  category: string | null
  decision: 'allow' | 'deny'
  ruleHit: string | null
  reason: string | null
  pendingHumanApproval?: boolean
  durationMs: number
  context: LogContext
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 本地 JSON Lines 审计日志
 * 按天分割，每行一条 JSON 记录
 */
export class FileLogger {
  private readonly logsDir: string

  constructor(baseDir: string) {
    this.logsDir = join(baseDir, 'logs')
  }

  private ensureDir(): void {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true })
    }
  }

  private getFilePath(): string {
    return join(this.logsDir, `${todayStr()}.jsonl`)
  }

  /**
   * 写一条审计日志
   */
  log(
    intent: PaymentIntent,
    decision: Decision,
    context: LogContext,
  ): void {
    this.ensureDir()

    const entry: LogEntry = {
      ts: decision.timestamp,
      agentId: intent.agentId,
      protocol: intent.protocol,
      amount: intent.amount,
      currency: intent.currency,
      merchant: intent.merchant,
      category: intent.category ?? null,
      decision: decision.allowed ? 'allow' : 'deny',
      ruleHit: decision.ruleHit ?? null,
      reason: decision.reason ?? null,
      durationMs: decision.durationMs,
      context,
    }

    if (decision.pendingHumanApproval) {
      entry.pendingHumanApproval = true
    }

    appendFileSync(this.getFilePath(), JSON.stringify(entry) + '\n', 'utf-8')
  }
}
