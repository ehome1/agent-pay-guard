import type { PaymentIntent } from './types.js'

/** x402 协议 402 响应中的支付要求 */
export interface X402PaymentRequired {
  amount: number
  currency: string
  /** 收款钱包地址 */
  receiver: string
  /** 链名称（base / solana / polygon） */
  chain?: string
  /** 请求的资源 URL */
  resource?: string
}

export interface X402AdapterOptions {
  agentId: string
  category?: string
}

/**
 * 将 x402 支付要求转换为统一 PaymentIntent
 */
export function fromX402(
  params: X402PaymentRequired,
  options: X402AdapterOptions,
): PaymentIntent {
  return {
    amount: params.amount,
    currency: params.currency.toLowerCase(),
    merchant: params.receiver,
    agentId: options.agentId,
    protocol: 'x402',
    category: options.category,
    description: params.resource,
    metadata: params.chain ? { chain: params.chain } : undefined,
  }
}
