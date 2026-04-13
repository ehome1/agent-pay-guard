import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkDeclarativeRules } from '../src/rules/declarative.js'
import { Tracker } from '../src/context/tracker.js'
import type { PaymentIntent } from '../src/adapters/types.js'
import type { AgentRuleConfig } from '../src/config/schema.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-declarative-test')

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

describe('declarative rules', () => {
  let tracker: Tracker

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
    tracker = new Tracker(TMP_DIR)
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  describe('protocols', () => {
    it('should allow when protocol is in list', () => {
      const rule: AgentRuleConfig = { protocols: ['stripe', 'x402'] }
      const d = checkDeclarativeRules(makeIntent({ protocol: 'stripe' }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny when protocol not in list', () => {
      const rule: AgentRuleConfig = { protocols: ['stripe'] }
      const d = checkDeclarativeRules(makeIntent({ protocol: 'x402' }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('protocols')
    })

    it('should allow all when protocols not configured', () => {
      const rule: AgentRuleConfig = {}
      const d = checkDeclarativeRules(makeIntent({ protocol: 'x402' }), rule, tracker)
      expect(d.allowed).toBe(true)
    })
  })

  describe('merchants', () => {
    it('should allow when merchant in whitelist', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'allow', list: ['api.openai.com', 'api.example.com'] },
      }
      const d = checkDeclarativeRules(makeIntent({ merchant: 'api.example.com' }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny when merchant not in whitelist', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'allow', list: ['api.openai.com'] },
      }
      const d = checkDeclarativeRules(makeIntent({ merchant: 'unknown.com' }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('merchants.allow')
    })

    it('should deny when merchant in blacklist', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'deny', list: ['scam.com'] },
      }
      const d = checkDeclarativeRules(makeIntent({ merchant: 'scam.com' }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('merchants.deny')
    })

    it('should allow when merchant not in blacklist', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'deny', list: ['scam.com'] },
      }
      const d = checkDeclarativeRules(makeIntent({ merchant: 'legit.com' }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny all on allow mode with empty list', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'allow', list: [] },
      }
      const d = checkDeclarativeRules(makeIntent(), rule, tracker)
      expect(d.allowed).toBe(false)
    })

    it('should allow all on deny mode with empty list', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'deny', list: [] },
      }
      const d = checkDeclarativeRules(makeIntent(), rule, tracker)
      expect(d.allowed).toBe(true)
    })
  })

  describe('categories', () => {
    it('should allow when category in whitelist', () => {
      const rule: AgentRuleConfig = {
        categories: { mode: 'allow', list: ['saas', 'api'] },
      }
      const d = checkDeclarativeRules(makeIntent({ category: 'saas' }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny when category not in whitelist', () => {
      const rule: AgentRuleConfig = {
        categories: { mode: 'allow', list: ['saas'] },
      }
      const d = checkDeclarativeRules(makeIntent({ category: 'gambling' }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('categories.allow')
    })

    it('should deny when category in blacklist', () => {
      const rule: AgentRuleConfig = {
        categories: { mode: 'deny', list: ['gambling', 'adult'] },
      }
      const d = checkDeclarativeRules(makeIntent({ category: 'gambling' }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('categories.deny')
    })

    it('should skip category check when intent has no category', () => {
      const rule: AgentRuleConfig = {
        categories: { mode: 'allow', list: ['saas'] },
      }
      const d = checkDeclarativeRules(makeIntent(), rule, tracker) // no category
      expect(d.allowed).toBe(true)
    })
  })

  describe('budget — per_transaction', () => {
    it('should allow at exact limit', () => {
      const rule: AgentRuleConfig = { budget: { perTransaction: 5000 } }
      const d = checkDeclarativeRules(makeIntent({ amount: 5000 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny over limit', () => {
      const rule: AgentRuleConfig = { budget: { perTransaction: 5000 } }
      const d = checkDeclarativeRules(makeIntent({ amount: 5001 }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('budget.per_transaction')
    })
  })

  describe('budget — daily', () => {
    it('should allow when under daily budget', () => {
      const rule: AgentRuleConfig = { budget: { daily: 10000 } }
      tracker.record('test-agent', 5000) // already spent 5000 today
      const d = checkDeclarativeRules(makeIntent({ amount: 4999 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should deny when would exceed daily budget', () => {
      const rule: AgentRuleConfig = { budget: { daily: 10000 } }
      tracker.record('test-agent', 5000)
      const d = checkDeclarativeRules(makeIntent({ amount: 5001 }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('budget.daily')
    })

    it('should allow exactly at daily budget', () => {
      const rule: AgentRuleConfig = { budget: { daily: 10000 } }
      tracker.record('test-agent', 5000)
      const d = checkDeclarativeRules(makeIntent({ amount: 5000 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })
  })

  describe('budget — monthly', () => {
    it('should deny when would exceed monthly budget', () => {
      const rule: AgentRuleConfig = { budget: { monthly: 20000 } }
      tracker.record('test-agent', 15000)
      const d = checkDeclarativeRules(makeIntent({ amount: 5001 }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.ruleHit).toBe('budget.monthly')
    })

    it('should allow at exact monthly budget', () => {
      const rule: AgentRuleConfig = { budget: { monthly: 20000 } }
      tracker.record('test-agent', 15000)
      const d = checkDeclarativeRules(makeIntent({ amount: 5000 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })
  })

  describe('human_approval', () => {
    it('should trigger approval when above threshold', () => {
      const rule: AgentRuleConfig = { humanApproval: { above: 10000 } }
      const d = checkDeclarativeRules(makeIntent({ amount: 10001 }), rule, tracker)
      expect(d.allowed).toBe(false)
      expect(d.pendingHumanApproval).toBe(true)
      expect(d.ruleHit).toBe('human_approval')
    })

    it('should not trigger at threshold', () => {
      const rule: AgentRuleConfig = { humanApproval: { above: 10000 } }
      const d = checkDeclarativeRules(makeIntent({ amount: 10000 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })

    it('should not trigger below threshold', () => {
      const rule: AgentRuleConfig = { humanApproval: { above: 10000 } }
      const d = checkDeclarativeRules(makeIntent({ amount: 100 }), rule, tracker)
      expect(d.allowed).toBe(true)
    })
  })

  describe('rule execution order (short-circuit)', () => {
    it('should deny on protocol before checking merchants', () => {
      const rule: AgentRuleConfig = {
        protocols: ['stripe'],
        merchants: { mode: 'allow', list: ['api.example.com'] },
      }
      const d = checkDeclarativeRules(
        makeIntent({ protocol: 'x402', merchant: 'api.example.com' }),
        rule,
        tracker,
      )
      expect(d.ruleHit).toBe('protocols')
    })

    it('should deny on merchant before checking budget', () => {
      const rule: AgentRuleConfig = {
        merchants: { mode: 'allow', list: ['only-this.com'] },
        budget: { perTransaction: 999999 },
      }
      const d = checkDeclarativeRules(makeIntent({ merchant: 'other.com' }), rule, tracker)
      expect(d.ruleHit).toBe('merchants.allow')
    })

    it('should check budget before human_approval', () => {
      const rule: AgentRuleConfig = {
        budget: { perTransaction: 100 },
        humanApproval: { above: 50 },
      }
      // amount 200 exceeds both per_transaction (100) and approval (50)
      // per_transaction should trigger first
      const d = checkDeclarativeRules(makeIntent({ amount: 200 }), rule, tracker)
      expect(d.ruleHit).toBe('budget.per_transaction')
    })
  })

  describe('combined rules', () => {
    it('should pass all checks for a valid intent', () => {
      const rule: AgentRuleConfig = {
        protocols: ['stripe', 'x402'],
        merchants: { mode: 'deny', list: ['scam.com'] },
        categories: { mode: 'deny', list: ['gambling'] },
        budget: { perTransaction: 5000, daily: 50000, monthly: 500000 },
        humanApproval: { above: 10000 },
      }
      const d = checkDeclarativeRules(
        makeIntent({ amount: 2000, category: 'saas' }),
        rule,
        tracker,
      )
      expect(d.allowed).toBe(true)
    })
  })
})
