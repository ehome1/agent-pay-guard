import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Guard } from '../src/guard.js'
import { resetRateLimits } from '../src/rules/safety.js'
import type { PaymentIntent } from '../src/adapters/types.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-integration-test')

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    amount: 1000,
    currency: 'usd',
    merchant: 'api.openai.com',
    agentId: 'my-agent',
    protocol: 'stripe',
    category: 'saas',
    ...overrides,
  }
}

function writeConfig(content: string): string {
  const p = join(TMP_DIR, 'guard.yaml')
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('Sprint 2 — Integration tests', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('场景1: 完整拦截链路 — fromConfig → check → deny', () => {
    const configPath = writeConfig(`
safety:
  max_transaction_hard_cap: 50000

agents:
  my-agent:
    merchants:
      mode: allow
      list:
        - api.openai.com
`)
    const guard = Guard.fromConfig(configPath)
    const d = guard.check(makeIntent({ merchant: 'unknown.com' }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('merchants.allow')
    expect(d.reason).toContain('unknown.com')
  })

  it('场景2: 完整放行链路 — check → allow → tracker 累加 → getStats', () => {
    const guard = Guard.create({
      agents: {
        'my-agent': {
          budget: { perTransaction: 5000, daily: 50000 },
          merchants: { mode: 'deny', list: [] },
        },
      },
    }, TMP_DIR)

    const d = guard.check(makeIntent({ amount: 2000 }))
    expect(d.allowed).toBe(true)

    const stats = guard.getStats('my-agent')
    expect(stats.todaySpent).toBe(2000)
    expect(stats.todayCount).toBe(1)
    expect(stats.lastTransaction).toBeDefined()
  })

  it('场景3: 累计预算触发 — 连续 6 笔，第 6 笔超日预算', () => {
    const guard = Guard.create({
      agents: {
        'my-agent': {
          budget: { daily: 5000 }, // $50 daily
        },
      },
    }, TMP_DIR)

    // 5 笔各 1000 = 累计 5000，刚好到限
    for (let i = 0; i < 5; i++) {
      const d = guard.check(makeIntent({ amount: 1000 }))
      expect(d.allowed).toBe(true)
    }

    // 第 6 笔哪怕只有 1，也超限
    const d = guard.check(makeIntent({ amount: 1 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('budget.daily')

    // 验证统计
    const stats = guard.getStats('my-agent')
    expect(stats.todaySpent).toBe(5000) // 被拒的不计入
    expect(stats.todayCount).toBe(5)
  })

  it('场景4: 多 Agent 隔离 — A 花光预算，B 不受影响', () => {
    const guard = Guard.create({
      agents: {
        'agent-A': { budget: { daily: 2000 } },
        'agent-B': { budget: { daily: 2000 } },
      },
    }, TMP_DIR)

    // Agent A 花光预算
    guard.check(makeIntent({ agentId: 'agent-A', amount: 2000 }))
    const dA = guard.check(makeIntent({ agentId: 'agent-A', amount: 1 }))
    expect(dA.allowed).toBe(false)

    // Agent B 完全不受影响
    const dB = guard.check(makeIntent({ agentId: 'agent-B', amount: 2000 }))
    expect(dB.allowed).toBe(true)
  })

  it('场景5: default 兜底 — 未声明的 agentId 走 default 规则', () => {
    const guard = Guard.create({
      agents: {
        'known-agent': { budget: { perTransaction: 9999 } },
      },
      default: { budget: { perTransaction: 500 } },
    }, TMP_DIR)

    // 已声明的 agent 使用自己的规则
    expect(guard.check(makeIntent({ agentId: 'known-agent', amount: 9999 })).allowed).toBe(true)

    // 未声明的 agent 使用 default
    expect(guard.check(makeIntent({ agentId: 'random-agent', amount: 501 })).allowed).toBe(false)
    expect(guard.check(makeIntent({ agentId: 'random-agent', amount: 500 })).allowed).toBe(true)
  })

  it('场景6: 规则短路 — 商户被拒时不检查预算', () => {
    const guard = Guard.create({
      agents: {
        'my-agent': {
          merchants: { mode: 'allow', list: ['only-this.com'] },
          budget: { perTransaction: 999999 }, // 预算很大
        },
      },
    }, TMP_DIR)

    const d = guard.check(makeIntent({ merchant: 'other.com', amount: 100 }))
    expect(d.ruleHit).toBe('merchants.allow') // 商户拒绝，不走到预算
  })

  it('场景7: rollback — 支付失败后回退预算', () => {
    const guard = Guard.create({
      agents: {
        'my-agent': { budget: { daily: 3000 } },
      },
    }, TMP_DIR)

    const intent = makeIntent({ amount: 2000 })

    // 放行
    expect(guard.check(intent).allowed).toBe(true)
    expect(guard.getStats('my-agent').todaySpent).toBe(2000)

    // 支付失败，回退
    guard.rollback(intent)
    expect(guard.getStats('my-agent').todaySpent).toBe(0)

    // 回退后又有预算了
    expect(guard.check(makeIntent({ amount: 2000 })).allowed).toBe(true)
  })

  it('场景8: safety + declarative 协同 — safety 优先于 declarative', () => {
    const guard = Guard.create({
      safety: { maxTransactionHardCap: 100 },
      agents: {
        'my-agent': {
          budget: { perTransaction: 999999 }, // declarative 允许
        },
      },
    }, TMP_DIR)

    // safety 的 hardCap 先拦截
    const d = guard.check(makeIntent({ amount: 101 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('max_transaction_hard_cap')
  })
})
