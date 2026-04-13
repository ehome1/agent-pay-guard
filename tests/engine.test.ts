import { describe, it, expect } from 'vitest'
import { runRuleChain } from '../src/rules/engine.js'
import type { RuleFn } from '../src/rules/engine.js'
import type { PaymentIntent, Decision } from '../src/adapters/types.js'

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

const alwaysAllow: RuleFn = () => ({
  allowed: true,
  timestamp: new Date().toISOString(),
  durationMs: 0,
})

const alwaysDeny: RuleFn = () => ({
  allowed: false,
  reason: 'blocked by test rule',
  ruleHit: 'test_deny',
  timestamp: new Date().toISOString(),
  durationMs: 0,
})

describe('rule engine', () => {
  describe('empty chain', () => {
    it('should allow when no rules', () => {
      const d = runRuleChain(makeIntent(), [])
      expect(d.allowed).toBe(true)
    })
  })

  describe('all pass', () => {
    it('should allow when all rules pass', () => {
      const d = runRuleChain(makeIntent(), [alwaysAllow, alwaysAllow, alwaysAllow])
      expect(d.allowed).toBe(true)
    })
  })

  describe('short-circuit on deny', () => {
    it('should deny immediately when first rule denies', () => {
      const callOrder: string[] = []
      const trackAllow: RuleFn = (intent) => {
        callOrder.push('allow')
        return alwaysAllow(intent)
      }
      const trackDeny: RuleFn = (intent) => {
        callOrder.push('deny')
        return alwaysDeny(intent)
      }

      const d = runRuleChain(makeIntent(), [trackDeny, trackAllow, trackAllow])
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('test_deny')
      expect(callOrder).toEqual(['deny']) // subsequent rules not called
    })

    it('should stop at second rule if it denies', () => {
      const callOrder: string[] = []
      const trackAllow: RuleFn = (intent) => {
        callOrder.push('allow')
        return alwaysAllow(intent)
      }
      const trackDeny: RuleFn = (intent) => {
        callOrder.push('deny')
        return alwaysDeny(intent)
      }

      const d = runRuleChain(makeIntent(), [trackAllow, trackDeny, trackAllow])
      expect(d.allowed).toBe(false)
      expect(callOrder).toEqual(['allow', 'deny'])
    })
  })

  describe('decision metadata', () => {
    it('should include durationMs on allow', () => {
      const d = runRuleChain(makeIntent(), [alwaysAllow])
      expect(d.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should include durationMs on deny', () => {
      const d = runRuleChain(makeIntent(), [alwaysDeny])
      expect(d.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should include timestamp on allow', () => {
      const d = runRuleChain(makeIntent(), [alwaysAllow])
      expect(d.timestamp).toBeDefined()
      expect(new Date(d.timestamp).getTime()).not.toBeNaN()
    })

    it('should preserve deny reason and ruleHit', () => {
      const customDeny: RuleFn = () => ({
        allowed: false,
        reason: 'custom reason',
        ruleHit: 'custom_rule',
        timestamp: new Date().toISOString(),
        durationMs: 0,
      })
      const d = runRuleChain(makeIntent(), [customDeny])
      expect(d.reason).toBe('custom reason')
      expect(d.ruleHit).toBe('custom_rule')
    })
  })

  describe('intent is passed to rules', () => {
    it('should pass the intent object to each rule', () => {
      let receivedIntent: PaymentIntent | undefined
      const captureRule: RuleFn = (intent) => {
        receivedIntent = intent
        return alwaysAllow(intent)
      }

      const intent = makeIntent({ amount: 42, agentId: 'special-agent' })
      runRuleChain(intent, [captureRule])
      expect(receivedIntent).toBe(intent)
      expect(receivedIntent!.amount).toBe(42)
      expect(receivedIntent!.agentId).toBe('special-agent')
    })
  })
})
