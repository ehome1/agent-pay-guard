import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Guard } from '../src/guard.js'
import { fromStripe } from '../src/adapters/stripe.js'
import { fromX402 } from '../src/adapters/x402.js'
import { resetRateLimits } from '../src/rules/safety.js'
import type { PaymentIntent } from '../src/adapters/types.js'
import type { LogEntry } from '../src/logger/file-logger.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-scenario-test')

function readAllLogs(): LogEntry[] {
  const logsDir = join(TMP_DIR, '.agent-pay-guard', 'logs')
  try {
    const files = readdirSync(logsDir).filter((f) => f.endsWith('.jsonl'))
    const entries: LogEntry[] = []
    for (const file of files) {
      const raw = readFileSync(join(logsDir, file), 'utf-8')
      for (const line of raw.trim().split('\n')) {
        if (line) entries.push(JSON.parse(line) as LogEntry)
      }
    }
    return entries
  } catch {
    return []
  }
}

describe('场景 A: Stripe 电商 Agent — 10 笔连续交易', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
  })
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  it('should handle a realistic shopping agent workflow', () => {
    const guard = Guard.create({
      safety: { maxTransactionHardCap: 100000 }, // 提高 hard cap 以测试声明式规则
      agents: {
        'shopping-agent': {
          budget: { perTransaction: 20000, daily: 50000, monthly: 500000 },
          merchants: {
            mode: 'allow',
            list: ['api.openai.com', 'shop.example.com', 'store.saas.io'],
          },
          humanApproval: { above: 10000 },
          protocols: ['stripe'],
        },
      },
    }, TMP_DIR)

    const results: Array<{ amount: number; allowed: boolean; ruleHit?: string }> = []

    // 笔 1-8: 白名单商户，合理金额 → 全部 allow
    const merchants = ['api.openai.com', 'shop.example.com', 'store.saas.io']
    for (let i = 0; i < 8; i++) {
      const intent = fromStripe(
        { amount: 2000, currency: 'usd', metadata: { merchant: merchants[i % 3]! } },
        { agentId: 'shopping-agent', category: 'saas' },
      )
      const d = guard.check(intent)
      results.push({ amount: 2000, allowed: d.allowed, ruleHit: d.ruleHit })
    }

    // 笔 9: 陌生商户 → deny
    const intent9 = fromStripe(
      { amount: 1000, currency: 'usd', metadata: { merchant: 'unknown-shop.com' } },
      { agentId: 'shopping-agent' },
    )
    const d9 = guard.check(intent9)
    results.push({ amount: 1000, allowed: d9.allowed, ruleHit: d9.ruleHit })

    // 笔 10: 高额 → pendingHumanApproval
    const intent10 = fromStripe(
      { amount: 15000, currency: 'usd', metadata: { merchant: 'api.openai.com' } },
      { agentId: 'shopping-agent' },
    )
    const d10 = guard.check(intent10)
    results.push({ amount: 15000, allowed: d10.allowed, ruleHit: d10.ruleHit })

    // 验证前 8 笔 allow
    for (let i = 0; i < 8; i++) {
      expect(results[i]!.allowed).toBe(true)
    }

    // 第 9 笔 deny by merchants
    expect(results[8]!.allowed).toBe(false)
    expect(results[8]!.ruleHit).toBe('merchants.allow')

    // 第 10 笔 deny by human_approval
    expect(results[9]!.allowed).toBe(false)
    expect(d10.pendingHumanApproval).toBe(true)

    // 验证日志完整
    const logs = readAllLogs()
    expect(logs).toHaveLength(10)
    expect(logs.filter((l) => l.decision === 'allow')).toHaveLength(8)
    expect(logs.filter((l) => l.decision === 'deny')).toHaveLength(2)

    // 验证统计
    const stats = guard.getStats('shopping-agent')
    expect(stats.todaySpent).toBe(16000) // 8 × 2000
    expect(stats.todayCount).toBe(8)
  })
})

describe('场景 B: x402 微支付高频 Agent — 200 笔/3分钟', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
  })
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  it('should enforce rate limit and daily budget on micro-payments', () => {
    const guard = Guard.create({
      safety: { rateLimit: 60, maxTransactionHardCap: 10000 },
      agents: {
        'research-agent': {
          budget: { daily: 500 }, // $5 日限
          protocols: ['x402'],
        },
      },
    }, TMP_DIR)

    let allowed = 0
    let deniedByRate = 0
    let deniedByBudget = 0

    for (let i = 0; i < 200; i++) {
      const intent = fromX402(
        { amount: 10, currency: 'usdc', receiver: '0xabc123', chain: 'base' },
        { agentId: 'research-agent', category: 'api' },
      )
      const d = guard.check(intent)
      if (d.allowed) {
        allowed++
      } else if (d.ruleHit === 'rate_limit') {
        deniedByRate++
      } else if (d.ruleHit === 'budget.daily') {
        deniedByBudget++
      }
    }

    // 日预算 500 / 每笔 10 = 最多 50 笔放行
    // 但 rate_limit 是 60/min，所以 50 笔都在限额内
    expect(allowed).toBe(50)
    // 第 51 笔开始被日预算拒绝
    expect(deniedByBudget).toBeGreaterThan(0)

    // 微支付金额精度正确（整数，无浮点误差）
    const stats = guard.getStats('research-agent')
    expect(stats.todaySpent).toBe(500) // 精确 500，不是 499.99999
  })
})

describe('场景 C: Agent 失控防护 — 死循环 1000 笔', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
  })
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  it('should cap damage from a runaway agent', () => {
    const guard = Guard.create({
      safety: { rateLimit: 60, maxTransactionHardCap: 10000 },
      agents: {
        'runaway-agent': {
          budget: { daily: 10000 }, // $100 日限
        },
      },
    }, TMP_DIR)

    let totalAllowed = 0
    let totalDenied = 0

    for (let i = 0; i < 1000; i++) {
      const d = guard.check({
        amount: 100, // $1/笔
        currency: 'usd',
        merchant: 'api.example.com',
        agentId: 'runaway-agent',
        protocol: 'stripe',
      })
      if (d.allowed) totalAllowed++
      else totalDenied++
    }

    // rate_limit 60/min → 最多 60 笔在第一分钟
    // daily budget 10000 / 100 per tx = 最多 100 笔
    // 但 rate_limit 先触发 → 只有 60 笔放行
    expect(totalAllowed).toBe(60)
    expect(totalDenied).toBe(940)

    // 总消费不超过 $60（60 笔 × $1）
    const stats = guard.getStats('runaway-agent')
    expect(stats.todaySpent).toBe(6000) // 6000 cents = $60
    expect(stats.todaySpent).toBeLessThanOrEqual(10000) // 不超过日限
  })
})

describe('场景 D: Project Vend 复现 — 社会工程攻击防护', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
  })
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  it('should block $0 "communist vending machine" attack', () => {
    const guard = Guard.create({}, TMP_DIR)
    const d = guard.check({
      amount: 0,
      currency: 'usd',
      merchant: 'vending-machine',
      agentId: 'vend-agent',
      protocol: 'stripe',
    })
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('reject_negative_amount')
  })

  it('should block unknown merchant large purchase (PS5)', () => {
    const guard = Guard.create({
      safety: { maxTransactionHardCap: 100000 }, // 提高 hard cap 以测试 merchant 规则
      agents: {
        'vend-agent': {
          merchants: { mode: 'allow', list: ['office-supplies.com'] },
          budget: { perTransaction: 5000 },
        },
      },
    }, TMP_DIR)

    // 尝试从陌生商户购买 PS5（$499 = 49900 cents）
    const d = guard.check({
      amount: 49900,
      currency: 'usd',
      merchant: 'playstation-store.com',
      agentId: 'vend-agent',
      protocol: 'stripe',
    })
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('merchants.allow')
  })

  it('should cap total losses with daily budget', () => {
    const guard = Guard.create({
      agents: {
        'vend-agent': {
          budget: { daily: 100000 }, // $1000 daily cap
        },
      },
    }, TMP_DIR)

    // 模拟 Agent 被骗持续消费
    let spent = 0
    for (let i = 0; i < 200; i++) {
      const d = guard.check({
        amount: 10000, // $100 each
        currency: 'usd',
        merchant: 'various-store.com',
        agentId: 'vend-agent',
        protocol: 'stripe',
      })
      if (d.allowed) spent += 10000
    }

    // 最多消费 $1000（10 笔 × $100）
    expect(spent).toBe(100000)
    expect(spent).toBeLessThanOrEqual(100000)
  })

  it('should block negative price manipulation', () => {
    const guard = Guard.create({}, TMP_DIR)
    const d = guard.check({
      amount: -500,
      currency: 'usd',
      merchant: 'vending-machine',
      agentId: 'vend-agent',
      protocol: 'stripe',
    })
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('reject_negative_amount')
  })
})
