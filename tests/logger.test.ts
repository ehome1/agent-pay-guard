import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FileLogger, type LogEntry } from '../src/logger/file-logger.js'
import type { PaymentIntent, Decision } from '../src/adapters/types.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-logger-test')

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    amount: 1000,
    currency: 'usd',
    merchant: 'api.example.com',
    agentId: 'test-agent',
    protocol: 'stripe',
    category: 'saas',
    ...overrides,
  }
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    allowed: true,
    timestamp: new Date().toISOString(),
    durationMs: 2,
    ...overrides,
  }
}

const defaultContext = {
  dailySpentBefore: 0,
  dailySpentAfter: 1000,
  monthlySpentBefore: 5000,
  monthlySpentAfter: 6000,
}

function readLogLines(dir: string): LogEntry[] {
  const logsDir = join(dir, 'logs')
  const files = readdirSync(logsDir).filter((f) => f.endsWith('.jsonl'))
  const entries: LogEntry[] = []
  for (const file of files) {
    const raw = readFileSync(join(logsDir, file), 'utf-8')
    for (const line of raw.trim().split('\n')) {
      entries.push(JSON.parse(line) as LogEntry)
    }
  }
  return entries
}

describe('logger/file-logger', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('should create logs directory and write an allow log', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(makeIntent(), makeDecision(), defaultContext)

    const entries = readLogLines(TMP_DIR)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.decision).toBe('allow')
    expect(entries[0]!.agentId).toBe('test-agent')
    expect(entries[0]!.amount).toBe(1000)
    expect(entries[0]!.ruleHit).toBeNull()
    expect(entries[0]!.reason).toBeNull()
  })

  it('should write a deny log with ruleHit and reason', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(
      makeIntent({ merchant: 'scam.com' }),
      makeDecision({
        allowed: false,
        ruleHit: 'merchants.deny',
        reason: '商户 scam.com 在黑名单中',
      }),
      { ...defaultContext, dailySpentAfter: 0, monthlySpentAfter: 5000 },
    )

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.decision).toBe('deny')
    expect(entries[0]!.ruleHit).toBe('merchants.deny')
    expect(entries[0]!.reason).toContain('scam.com')
  })

  it('should include context before/after amounts', () => {
    const logger = new FileLogger(TMP_DIR)
    const ctx = {
      dailySpentBefore: 2500,
      dailySpentAfter: 3500,
      monthlySpentBefore: 35000,
      monthlySpentAfter: 36000,
    }
    logger.log(makeIntent(), makeDecision(), ctx)

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.context.dailySpentBefore).toBe(2500)
    expect(entries[0]!.context.dailySpentAfter).toBe(3500)
    expect(entries[0]!.context.monthlySpentBefore).toBe(35000)
    expect(entries[0]!.context.monthlySpentAfter).toBe(36000)
  })

  it('should append multiple entries to the same file', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(makeIntent({ amount: 100 }), makeDecision(), defaultContext)
    logger.log(makeIntent({ amount: 200 }), makeDecision(), defaultContext)
    logger.log(makeIntent({ amount: 300 }), makeDecision(), defaultContext)

    const entries = readLogLines(TMP_DIR)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.amount).toBe(100)
    expect(entries[1]!.amount).toBe(200)
    expect(entries[2]!.amount).toBe(300)
  })

  it('should include pendingHumanApproval when set', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(
      makeIntent(),
      makeDecision({ allowed: false, pendingHumanApproval: true, ruleHit: 'human_approval' }),
      defaultContext,
    )

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.pendingHumanApproval).toBe(true)
  })

  it('should handle null category gracefully', () => {
    const logger = new FileLogger(TMP_DIR)
    const intent = makeIntent()
    delete (intent as Record<string, unknown>)['category']
    logger.log(intent, makeDecision(), defaultContext)

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.category).toBeNull()
  })

  it('should log description when provided', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(
      makeIntent({ description: 'Paying for GPT-4 call to summarize user document #1234' }),
      makeDecision(),
      defaultContext,
    )

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.description).toBe('Paying for GPT-4 call to summarize user document #1234')
  })

  it('should set description to null when not provided', () => {
    const logger = new FileLogger(TMP_DIR)
    logger.log(makeIntent(), makeDecision(), defaultContext)

    const entries = readLogLines(TMP_DIR)
    expect(entries[0]!.description).toBeNull()
  })
})
