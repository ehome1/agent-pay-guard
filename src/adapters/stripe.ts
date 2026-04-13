import type { PaymentIntent } from './types.js'

/** Stripe 支付参数的子集（我们只关心这些字段） */
export interface StripePaymentParams {
  amount: number
  currency: string
  metadata?: Record<string, string>
  description?: string
}

export interface StripeAdapterOptions {
  agentId: string
  category?: string
  /** 如不传，尝试从 metadata.merchant 或 description 提取 */
  merchant?: string
}

/**
 * 将 Stripe 支付参数转换为统一 PaymentIntent
 */
export function fromStripe(
  params: StripePaymentParams,
  options: StripeAdapterOptions,
): PaymentIntent {
  return {
    amount: params.amount,
    currency: params.currency.toLowerCase(),
    merchant:
      options.merchant ??
      params.metadata?.['merchant'] ??
      params.description ??
      'unknown',
    agentId: options.agentId,
    protocol: 'stripe',
    category: options.category,
    description: params.description,
    metadata: params.metadata,
  }
}
