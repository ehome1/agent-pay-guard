import { describe, it, expect } from 'vitest'
import { fromStripe } from '../src/adapters/stripe.js'
import { fromX402 } from '../src/adapters/x402.js'

describe('adapters/stripe — fromStripe', () => {
  it('should convert basic Stripe params', () => {
    const intent = fromStripe(
      { amount: 4999, currency: 'USD' },
      { agentId: 'shop-agent' },
    )
    expect(intent.amount).toBe(4999)
    expect(intent.currency).toBe('usd') // lowercased
    expect(intent.protocol).toBe('stripe')
    expect(intent.agentId).toBe('shop-agent')
    expect(intent.merchant).toBe('unknown')
  })

  it('should extract merchant from metadata', () => {
    const intent = fromStripe(
      { amount: 100, currency: 'usd', metadata: { merchant: 'api.openai.com' } },
      { agentId: 'agent-1' },
    )
    expect(intent.merchant).toBe('api.openai.com')
  })

  it('should prefer explicit merchant over metadata', () => {
    const intent = fromStripe(
      { amount: 100, currency: 'usd', metadata: { merchant: 'from-meta' } },
      { agentId: 'agent-1', merchant: 'explicit.com' },
    )
    expect(intent.merchant).toBe('explicit.com')
  })

  it('should fallback to description when no merchant', () => {
    const intent = fromStripe(
      { amount: 100, currency: 'usd', description: 'Payment to vendor' },
      { agentId: 'agent-1' },
    )
    expect(intent.merchant).toBe('Payment to vendor')
  })

  it('should pass through category', () => {
    const intent = fromStripe(
      { amount: 100, currency: 'usd' },
      { agentId: 'agent-1', category: 'saas' },
    )
    expect(intent.category).toBe('saas')
  })

  it('should pass through metadata', () => {
    const intent = fromStripe(
      { amount: 100, currency: 'usd', metadata: { order: '12345' } },
      { agentId: 'agent-1' },
    )
    expect(intent.metadata).toEqual({ order: '12345' })
  })
})

describe('adapters/x402 — fromX402', () => {
  it('should convert basic x402 payment required', () => {
    const intent = fromX402(
      { amount: 100, currency: 'USDC', receiver: '0xabc123' },
      { agentId: 'research-agent' },
    )
    expect(intent.amount).toBe(100)
    expect(intent.currency).toBe('usdc') // lowercased
    expect(intent.protocol).toBe('x402')
    expect(intent.agentId).toBe('research-agent')
    expect(intent.merchant).toBe('0xabc123') // receiver as merchant
  })

  it('should include chain in metadata', () => {
    const intent = fromX402(
      { amount: 50, currency: 'USDC', receiver: '0xdef', chain: 'base' },
      { agentId: 'agent-1' },
    )
    expect(intent.metadata).toEqual({ chain: 'base' })
  })

  it('should omit metadata when no chain', () => {
    const intent = fromX402(
      { amount: 50, currency: 'USDC', receiver: '0xdef' },
      { agentId: 'agent-1' },
    )
    expect(intent.metadata).toBeUndefined()
  })

  it('should use resource as description', () => {
    const intent = fromX402(
      {
        amount: 100,
        currency: 'USDC',
        receiver: '0xabc',
        resource: 'https://api.example.com/data',
      },
      { agentId: 'agent-1' },
    )
    expect(intent.description).toBe('https://api.example.com/data')
  })

  it('should pass through category', () => {
    const intent = fromX402(
      { amount: 100, currency: 'USDC', receiver: '0xabc' },
      { agentId: 'agent-1', category: 'api' },
    )
    expect(intent.category).toBe('api')
  })
})
