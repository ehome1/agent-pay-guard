# agent-pay-guard

Local-first payment guard for AI agents. **Check before your agent spends.**

```
npm install agent-pay-guard
```

## Why

AI agents are starting to make payments — calling APIs, buying resources, paying for compute. Without guardrails, a single prompt injection or runaway loop can drain your budget in seconds.

`agent-pay-guard` sits between your agent and the payment rail. Every transaction goes through a rule chain that checks amount limits, merchant allowlists, rate limits, and more — all evaluated locally, in <1ms, with zero network calls.

## Quick Start

### 1. Initialize config

```bash
npx agent-pay-guard
```

This generates a `guard.yaml` with sensible defaults. Pick from three templates:
- **conservative** — strict limits, merchant allowlist, work-hours only
- **standard** — balanced limits, merchant denylist, high-amount approval
- **permissive** — high limits, minimal restrictions

### 2. Use in code

```typescript
import { Guard } from 'agent-pay-guard'

const guard = Guard.fromConfig() // reads ./guard.yaml

const decision = guard.check({
  amount: 2000,       // cents
  currency: 'usd',
  merchant: 'api.openai.com',
  agentId: 'my-agent',
  protocol: 'stripe',
})

if (decision.allowed) {
  // proceed with payment
  await stripe.paymentIntents.create({ amount: 2000, currency: 'usd' })
} else {
  console.log(`Blocked: ${decision.reason} (rule: ${decision.ruleHit})`)
}
```

### 3. Or use programmatically (no YAML)

```typescript
const guard = Guard.create({
  agents: {
    'my-agent': {
      budget: { perTransaction: 5000, daily: 50000, monthly: 500000 },
      merchants: { mode: 'allow', list: ['api.openai.com', 'api.anthropic.com'] },
      humanApproval: { above: 10000 },
    },
  },
})
```

## Adapters

Normalize payment data from different protocols into a unified `PaymentIntent`:

### Stripe

```typescript
import { Guard } from 'agent-pay-guard'
import { fromStripe } from 'agent-pay-guard/adapters/stripe'

const guard = Guard.fromConfig()
const intent = fromStripe(
  { amount: 2000, currency: 'usd', metadata: { merchant: 'api.openai.com' } },
  { agentId: 'my-agent', category: 'saas' },
)
const decision = guard.check(intent)
```

### x402

```typescript
import { fromX402 } from 'agent-pay-guard/adapters/x402'

const intent = fromX402(
  { amount: 10, currency: 'usdc', receiver: '0xabc...', chain: 'base' },
  { agentId: 'research-agent', category: 'api' },
)
const decision = guard.check(intent)
```

## Configuration

`guard.yaml` example:

```yaml
safety:
  max_transaction_hard_cap: 50000   # $500 absolute max
  rate_limit: 60                     # max 60 checks/min per agent

agents:
  my-agent:
    budget:
      per_transaction: 5000          # $50/tx
      daily: 50000                   # $500/day
      monthly: 500000                # $5,000/mo

    merchants:
      mode: allow                    # allowlist mode
      list:
        - api.openai.com
        - api.anthropic.com

    categories:
      mode: deny                     # denylist mode
      list:
        - gambling

    protocols:
      - stripe
      - x402

    schedule:
      timezone: UTC
      allowed_hours: "09:00-18:00"
      allowed_days: [mon, tue, wed, thu, fri]

    human_approval:
      above: 10000                   # >$100 needs human ok

default:
  budget:
    per_transaction: 2000
    daily: 10000
```

## Rule Execution Order

Every `guard.check()` call runs through rules in this order. First deny wins (short-circuit):

**Safety rules** (always enforced, not configurable):
1. `reject_negative_amount` — blocks amount <= 0
2. `reject_missing_agent_id` — blocks empty agentId
3. `max_transaction_hard_cap` — absolute ceiling per transaction
4. `rate_limit` — sliding window per agent (default 60/min)

**Declarative rules** (from your config):
5. `protocols` — allowed payment protocols
6. `schedule` — time-of-day and day-of-week restrictions
7. `merchants.allow` / `merchants.deny` — merchant allowlist or denylist
8. `categories.allow` / `categories.deny` — category restrictions
9. `budget.per_transaction` — single transaction limit
10. `budget.daily` — rolling daily spend cap
11. `budget.monthly` — rolling monthly spend cap
12. `human_approval` — flags high-value transactions for review

## API

### `Guard.fromConfig(path?: string): Guard`

Create from a YAML config file. Defaults to `./guard.yaml`. Falls back to default safety rules if file doesn't exist.

### `Guard.create(config?: GuardConfig, baseDir?: string): Guard`

Create programmatically without a file.

### `guard.check(intent: PaymentIntent): Decision`

Evaluate a payment intent against all rules.

```typescript
interface PaymentIntent {
  amount: number        // in smallest unit (cents, etc.)
  currency: string
  merchant: string
  agentId: string
  protocol: string
  category?: string
  description?: string
  metadata?: Record<string, unknown>
}

interface Decision {
  allowed: boolean
  reason?: string       // human-readable explanation
  ruleHit?: string      // which rule triggered denial
  timestamp: string
  durationMs: number
  pendingHumanApproval?: boolean
}
```

### `guard.rollback(intent: PaymentIntent): void`

Revert spend tracking when a payment fails downstream.

### `guard.getStats(agentId: string): AgentStats`

Get cumulative spend stats for an agent.

```typescript
interface AgentStats {
  todaySpent: number
  monthSpent: number
  todayCount: number
  lastTransaction?: string
}
```

## Local Storage

All data stays on your machine:

```
.agent-pay-guard/
  context.json          # spend tracking (daily/monthly per agent)
  logs/
    2024-01-15.jsonl    # audit log (one file per day, JSON Lines)
```

Add `.agent-pay-guard/` to your `.gitignore`.

## License

MIT
