import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Guard } from '../src/guard.js'
import { resetRateLimits } from '../src/rules/safety.js'
import type { PaymentIntent } from '../src/adapters/types.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-smoke-test')

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    amount: 1000,
    currency: 'usd',
    merchant: 'api.example.com',
    agentId: 'test-agent',
    protocol: 'stripe',
    ...overrides,
  }
}

describe('Guard — Sprint 1 smoke tests', () => {
  let guard: Guard

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    resetRateLimits()
    guard = Guard.create({}, TMP_DIR)
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('should allow a normal payment', () => {
    const d = guard.check(makeIntent())
    expect(d.allowed).toBe(true)
    expect(d.timestamp).toBeDefined()
    expect(d.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should deny amount = 0', () => {
    const d = guard.check(makeIntent({ amount: 0 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('reject_negative_amount')
  })

  it('should deny negative amount', () => {
    const d = guard.check(makeIntent({ amount: -500 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('reject_negative_amount')
  })

  it('should deny empty agentId', () => {
    const d = guard.check(makeIntent({ agentId: '' }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('reject_missing_agent_id')
  })

  it('should deny amount exceeding hard cap', () => {
    const d = guard.check(makeIntent({ amount: 10001 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('max_transaction_hard_cap')
  })

  it('should deny when rate limited', () => {
    // Exhaust the rate limit (default 60/min)
    for (let i = 0; i < 60; i++) {
      const d = guard.check(makeIntent())
      expect(d.allowed).toBe(true)
    }
    // The 61st should be denied
    const d = guard.check(makeIntent())
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('rate_limit')
  })

  it('should respect custom safety config', () => {
    const strictGuard = Guard.create({
      safety: { maxTransactionHardCap: 500, rateLimit: 3 },
    }, TMP_DIR)

    // Hard cap at 500
    expect(strictGuard.check(makeIntent({ amount: 501 })).allowed).toBe(false)
    expect(strictGuard.check(makeIntent({ amount: 500 })).allowed).toBe(true)

    // Rate limit at 3: 1 already used above (501 denied by hard_cap doesn't count)
    // So: call 1 = amount 500 above (allow), call 2, call 3 = allow, call 4 = deny
    strictGuard.check(makeIntent({ amount: 100 }))
    strictGuard.check(makeIntent({ amount: 100 }))
    const d = strictGuard.check(makeIntent({ amount: 100 }))
    expect(d.allowed).toBe(false)
    expect(d.ruleHit).toBe('rate_limit')
  })

  it('should work with fromConfig when no config file exists', () => {
    // fromConfig with nonexistent file should use defaults gracefully
    const fileGuard = Guard.fromConfig('/tmp/nonexistent-guard.yaml')
    const d = fileGuard.check(makeIntent())
    expect(d.allowed).toBe(true)
  })
})
