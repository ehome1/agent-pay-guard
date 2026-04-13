import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../src/config/loader.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-loader-test')

function writeTmpYaml(filename: string, content: string): string {
  const p = join(TMP_DIR, filename)
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('config/loader', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  describe('valid config', () => {
    it('should load a minimal config', () => {
      const p = writeTmpYaml('min.yaml', `
safety:
  max_transaction_hard_cap: 5000
  rate_limit: 10
`)
      const config = loadConfig(p)
      expect(config.safety?.maxTransactionHardCap).toBe(5000)
      expect(config.safety?.rateLimit).toBe(10)
    })

    it('should load agents with full config', () => {
      const p = writeTmpYaml('full.yaml', `
safety:
  max_transaction_hard_cap: 50000
  rate_limit: 60

agents:
  my-agent:
    budget:
      per_transaction: 5000
      daily: 50000
      monthly: 500000
    merchants:
      mode: deny
      list:
        - scam-site.com
    categories:
      mode: deny
      list:
        - gambling
    protocols:
      - stripe
      - x402
    schedule:
      timezone: Asia/Shanghai
      allowed_hours: "09:00-22:00"
      allowed_days: [mon, tue, wed, thu, fri]
    human_approval:
      above: 10000

default:
  budget:
    per_transaction: 2000
    daily: 10000
`)
      const config = loadConfig(p)

      // safety
      expect(config.safety?.maxTransactionHardCap).toBe(50000)

      // agent rule
      const agent = config.agents?.['my-agent']
      expect(agent).toBeDefined()
      expect(agent!.budget?.perTransaction).toBe(5000)
      expect(agent!.budget?.daily).toBe(50000)
      expect(agent!.budget?.monthly).toBe(500000)
      expect(agent!.merchants?.mode).toBe('deny')
      expect(agent!.merchants?.list).toEqual(['scam-site.com'])
      expect(agent!.categories?.list).toEqual(['gambling'])
      expect(agent!.protocols).toEqual(['stripe', 'x402'])
      expect(agent!.schedule?.timezone).toBe('Asia/Shanghai')
      expect(agent!.schedule?.allowedHours).toBe('09:00-22:00')
      expect(agent!.schedule?.allowedDays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
      expect(agent!.humanApproval?.above).toBe(10000)

      // default
      expect(config.default?.budget?.perTransaction).toBe(2000)
      expect(config.default?.budget?.daily).toBe(10000)
    })

    it('should load config with only safety section', () => {
      const p = writeTmpYaml('safety-only.yaml', `
safety:
  max_transaction_hard_cap: 999
`)
      const config = loadConfig(p)
      expect(config.safety?.maxTransactionHardCap).toBe(999)
      expect(config.agents).toBeUndefined()
      expect(config.default).toBeUndefined()
    })
  })

  describe('file errors', () => {
    it('should throw on nonexistent file', () => {
      expect(() => loadConfig('/tmp/nonexistent-guard.yaml')).toThrow('配置文件不存在')
    })

    it('should throw on empty file', () => {
      const p = writeTmpYaml('empty.yaml', '')
      expect(() => loadConfig(p)).toThrow('配置文件为空')
    })

    it('should throw on whitespace-only file', () => {
      const p = writeTmpYaml('ws.yaml', '   \n  \n  ')
      expect(() => loadConfig(p)).toThrow('配置文件为空')
    })
  })

  describe('YAML syntax errors', () => {
    it('should throw on invalid YAML', () => {
      const p = writeTmpYaml('bad.yaml', `
safety:
  max_transaction_hard_cap: [invalid
`)
      expect(() => loadConfig(p)).toThrow('YAML 解析失败')
    })
  })

  describe('schema validation errors', () => {
    it('should reject unknown top-level keys', () => {
      const p = writeTmpYaml('extra.yaml', `
safety:
  max_transaction_hard_cap: 100
unknown_key: true
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject wrong type for max_transaction_hard_cap', () => {
      const p = writeTmpYaml('type.yaml', `
safety:
  max_transaction_hard_cap: "not a number"
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject invalid merchants mode', () => {
      const p = writeTmpYaml('mode.yaml', `
agents:
  my-agent:
    merchants:
      mode: block
      list: []
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject invalid protocol', () => {
      const p = writeTmpYaml('proto.yaml', `
agents:
  my-agent:
    protocols:
      - paypal
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject invalid day name', () => {
      const p = writeTmpYaml('day.yaml', `
agents:
  my-agent:
    schedule:
      allowed_days:
        - monday
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject invalid allowed_hours format', () => {
      const p = writeTmpYaml('hours.yaml', `
agents:
  my-agent:
    schedule:
      allowed_hours: "9am-5pm"
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })

    it('should reject negative rate_limit', () => {
      const p = writeTmpYaml('neg.yaml', `
safety:
  rate_limit: 0
`)
      expect(() => loadConfig(p)).toThrow('配置校验失败')
    })
  })
})
