// Core
export { Guard } from './guard.js'

// Types — payment
export type { PaymentIntent, Decision, AgentStats } from './adapters/types.js'

// Types — config
export type {
  GuardConfig,
  SafetyConfig,
  BudgetConfig,
  ListConfig,
  ScheduleConfig,
  HumanApprovalConfig,
  AgentRuleConfig,
} from './config/schema.js'

// Adapters (also available via subpath imports)
export { fromStripe, type StripePaymentParams, type StripeAdapterOptions } from './adapters/stripe.js'
export { fromX402, type X402PaymentRequired, type X402AdapterOptions } from './adapters/x402.js'
