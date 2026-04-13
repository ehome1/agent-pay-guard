import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../src/config/loader.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-cli-test')
const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates')

describe('CLI 模板验证', () => {
  beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }))
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  const templates = ['conservative', 'standard', 'permissive'] as const

  for (const name of templates) {
    describe(`${name}.yaml`, () => {
      it('should exist in templates directory', () => {
        const path = join(TEMPLATES_DIR, `${name}.yaml`)
        expect(existsSync(path)).toBe(true)
      })

      it('should pass schema validation via loadConfig', () => {
        const path = join(TEMPLATES_DIR, `${name}.yaml`)
        const config = loadConfig(path)
        expect(config).toBeDefined()
        expect(config.agents).toBeDefined()
        expect(config.agents!['my-agent']).toBeDefined()
      })

      it('should have valid safety settings', () => {
        const path = join(TEMPLATES_DIR, `${name}.yaml`)
        const config = loadConfig(path)
        expect(config.safety).toBeDefined()
        expect(config.safety!.maxTransactionHardCap).toBeGreaterThan(0)
        expect(config.safety!.rateLimit).toBeGreaterThan(0)
      })

      it('should produce valid config after agent ID replacement', () => {
        const templatePath = join(TEMPLATES_DIR, `${name}.yaml`)
        const raw = readFileSync(templatePath, 'utf-8')
        const replaced = raw.replace(/my-agent/g, 'custom-agent-123')

        const tmpPath = join(TMP_DIR, `${name}-replaced.yaml`)
        writeFileSync(tmpPath, replaced, 'utf-8')

        const config = loadConfig(tmpPath)
        expect(config.agents!['custom-agent-123']).toBeDefined()
        expect(config.agents!['my-agent']).toBeUndefined()
      })
    })
  }
})

describe('CLI 目录创建逻辑', () => {
  beforeEach(() => mkdirSync(TMP_DIR, { recursive: true }))
  afterEach(() => rmSync(TMP_DIR, { recursive: true, force: true }))

  it('should create .agent-pay-guard/logs directory', () => {
    const guardDir = join(TMP_DIR, '.agent-pay-guard')
    mkdirSync(join(guardDir, 'logs'), { recursive: true })

    expect(existsSync(guardDir)).toBe(true)
    expect(existsSync(join(guardDir, 'logs'))).toBe(true)
  })

  it('should not fail when directory already exists', () => {
    const guardDir = join(TMP_DIR, '.agent-pay-guard')
    mkdirSync(join(guardDir, 'logs'), { recursive: true })
    // Second call should not throw
    expect(() => {
      mkdirSync(join(guardDir, 'logs'), { recursive: true })
    }).not.toThrow()
  })
})

describe('CLI 模板内容一致性', () => {
  it('conservative should be strictest', () => {
    const config = loadConfig(join(TEMPLATES_DIR, 'conservative.yaml'))
    const agent = config.agents!['my-agent']!
    expect(agent.budget!.perTransaction).toBeLessThanOrEqual(1000)
    expect(agent.merchants!.mode).toBe('allow') // allow-list = strict
    expect(agent.schedule).toBeDefined() // has time restrictions
  })

  it('permissive should be most relaxed', () => {
    const config = loadConfig(join(TEMPLATES_DIR, 'permissive.yaml'))
    const agent = config.agents!['my-agent']!
    expect(agent.budget!.perTransaction).toBeGreaterThanOrEqual(10000)
    expect(agent.merchants!.mode).toBe('deny') // deny-list = relaxed
  })

  it('standard should be between conservative and permissive', () => {
    const conservative = loadConfig(join(TEMPLATES_DIR, 'conservative.yaml'))
    const standard = loadConfig(join(TEMPLATES_DIR, 'standard.yaml'))
    const permissive = loadConfig(join(TEMPLATES_DIR, 'permissive.yaml'))

    const cBudget = conservative.agents!['my-agent']!.budget!.daily!
    const sBudget = standard.agents!['my-agent']!.budget!.daily!
    const pBudget = permissive.agents!['my-agent']!.budget!.daily!

    expect(sBudget).toBeGreaterThan(cBudget)
    expect(sBudget).toBeLessThan(pBudget)
  })

  it('all templates should have default rules', () => {
    for (const name of ['conservative', 'standard', 'permissive']) {
      const config = loadConfig(join(TEMPLATES_DIR, `${name}.yaml`))
      expect(config.default).toBeDefined()
      expect(config.default!.budget).toBeDefined()
    }
  })
})
