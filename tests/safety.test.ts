import { describe, it, expect, beforeEach } from 'vitest'
import { checkSafety, resetRateLimits } from '../src/rules/safety.js'
import type { PaymentIntent } from '../src/adapters/types.js'

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

describe('safety rules', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  describe('reject_negative_amount', () => {
    it('should deny amount = 0', () => {
      const d = checkSafety(makeIntent({ amount: 0 }))
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('reject_negative_amount')
    })

    it('should deny amount = -1', () => {
      const d = checkSafety(makeIntent({ amount: -1 }))
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('reject_negative_amount')
    })

    it('should deny amount = -999999', () => {
      const d = checkSafety(makeIntent({ amount: -999999 }))
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('reject_negative_amount')
    })

    it('should allow amount = 1', () => {
      const d = checkSafety(makeIntent({ amount: 1 }))
      expect(d.allowed).toBe(true)
    })
  })

  describe('reject_missing_agent_id', () => {
    it('should deny empty string agentId', () => {
      const d = checkSafety(makeIntent({ agentId: '' }))
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('reject_missing_agent_id')
    })

    it('should allow valid agentId', () => {
      const d = checkSafety(makeIntent({ agentId: 'my-agent' }))
      expect(d.allowed).toBe(true)
    })
  })

  describe('max_transaction_hard_cap', () => {
    it('should deny amount exceeding default hard cap (10000)', () => {
      const d = checkSafety(makeIntent({ amount: 10001 }))
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('max_transaction_hard_cap')
    })

    it('should allow amount exactly at hard cap', () => {
      const d = checkSafety(makeIntent({ amount: 10000 }))
      expect(d.allowed).toBe(true)
    })

    it('should allow amount just below hard cap', () => {
      const d = checkSafety(makeIntent({ amount: 9999 }))
      expect(d.allowed).toBe(true)
    })

    it('should use custom hard cap from config', () => {
      const d = checkSafety(
        makeIntent({ amount: 5001 }),
        { maxTransactionHardCap: 5000 },
      )
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('max_transaction_hard_cap')
    })

    it('should allow at custom hard cap boundary', () => {
      const d = checkSafety(
        makeIntent({ amount: 5000 }),
        { maxTransactionHardCap: 5000 },
      )
      expect(d.allowed).toBe(true)
    })
  })

  describe('rate_limit', () => {
    it('should allow requests within rate limit', () => {
      for (let i = 0; i < 60; i++) {
        const d = checkSafety(makeIntent())
        expect(d.allowed).toBe(true)
      }
    })

    it('should deny the 61st request within 1 minute', () => {
      for (let i = 0; i < 60; i++) {
        checkSafety(makeIntent())
      }
      const d = checkSafety(makeIntent())
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('rate_limit')
    })

    it('should track agents independently', () => {
      // Exhaust agent-A's limit
      for (let i = 0; i < 60; i++) {
        checkSafety(makeIntent({ agentId: 'agent-A' }))
      }
      const denyA = checkSafety(makeIntent({ agentId: 'agent-A' }))
      expect(denyA.allowed).toBe(false)

      // agent-B should still be allowed
      const allowB = checkSafety(makeIntent({ agentId: 'agent-B' }))
      expect(allowB.allowed).toBe(true)
    })

    it('should use custom rate limit', () => {
      for (let i = 0; i < 5; i++) {
        checkSafety(makeIntent(), { rateLimit: 5 })
      }
      const d = checkSafety(makeIntent(), { rateLimit: 5 })
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('rate_limit')
    })
  })

  describe('rule priority', () => {
    it('checks amount before agentId', () => {
      // amount=0 should be caught first, even if agentId is also empty
      const d = checkSafety(makeIntent({ amount: 0, agentId: '' }))
      expect(d.ruleHit).toBe('reject_negative_amount')
    })

    it('checks agentId before hard cap', () => {
      const d = checkSafety(makeIntent({ agentId: '', amount: 999999 }))
      expect(d.ruleHit).toBe('reject_missing_agent_id')
    })
  })

  describe('decision metadata', () => {
    it('should include timestamp on allow', () => {
      const d = checkSafety(makeIntent())
      expect(d.timestamp).toBeDefined()
      expect(new Date(d.timestamp).getTime()).not.toBeNaN()
    })

    it('should include timestamp and reason on deny', () => {
      const d = checkSafety(makeIntent({ amount: 0 }))
      expect(d.timestamp).toBeDefined()
      expect(d.reason).toBeDefined()
      expect(d.reason!.length).toBeGreaterThan(0)
    })
  })
})
