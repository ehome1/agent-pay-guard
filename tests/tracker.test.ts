import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Tracker } from '../src/context/tracker.js'

const TMP_DIR = join(import.meta.dirname, '.tmp-tracker-test')

describe('context/tracker', () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('first use', () => {
    it('should create context.json on first record', () => {
      const dir = join(TMP_DIR, 'fresh')
      mkdirSync(dir, { recursive: true })
      const tracker = new Tracker(dir)
      tracker.record('agent-1', 1000)
      expect(existsSync(join(dir, 'context.json'))).toBe(true)
    })

    it('should start with 0 spent', () => {
      const tracker = new Tracker(TMP_DIR)
      const stats = tracker.getStats('agent-1')
      expect(stats.todaySpent).toBe(0)
      expect(stats.monthSpent).toBe(0)
      expect(stats.todayCount).toBe(0)
    })
  })

  describe('accumulation', () => {
    it('should accumulate daily and monthly spent', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 1000)
      tracker.record('agent-1', 2000)
      tracker.record('agent-1', 500)

      const stats = tracker.getStats('agent-1')
      expect(stats.todaySpent).toBe(3500)
      expect(stats.monthSpent).toBe(3500)
      expect(stats.todayCount).toBe(3)
    })

    it('should track agents independently', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-A', 1000)
      tracker.record('agent-B', 5000)
      tracker.record('agent-A', 2000)

      expect(tracker.getStats('agent-A').todaySpent).toBe(3000)
      expect(tracker.getStats('agent-B').todaySpent).toBe(5000)
    })

    it('should set lastTransaction timestamp', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 100)
      const stats = tracker.getStats('agent-1')
      expect(stats.lastTransaction).toBeDefined()
      expect(new Date(stats.lastTransaction!).getTime()).not.toBeNaN()
    })
  })

  describe('getSpent', () => {
    it('should return current daily and monthly spent', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 1500)
      const spent = tracker.getSpent('agent-1')
      expect(spent.dailySpent).toBe(1500)
      expect(spent.monthlySpent).toBe(1500)
    })
  })

  describe('rollback', () => {
    it('should subtract amount on rollback', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 3000)
      tracker.record('agent-1', 2000)
      tracker.rollback('agent-1', 2000)

      const stats = tracker.getStats('agent-1')
      expect(stats.todaySpent).toBe(3000)
      expect(stats.monthSpent).toBe(3000)
      expect(stats.todayCount).toBe(1)
    })

    it('should not go below 0', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 100)
      tracker.rollback('agent-1', 99999)

      const stats = tracker.getStats('agent-1')
      expect(stats.todaySpent).toBe(0)
      expect(stats.monthSpent).toBe(0)
      expect(stats.todayCount).toBe(0)
    })
  })

  describe('date reset', () => {
    it('should reset daily when date changes', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 5000)

      // Manually tamper with the stored date to simulate yesterday
      const filePath = join(TMP_DIR, 'context.json')
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      data['agent-1'].daily.date = '2020-01-01'
      writeFileSync(filePath, JSON.stringify(data), 'utf-8')

      // Re-create tracker to reload from file
      const tracker2 = new Tracker(TMP_DIR)
      const stats = tracker2.getStats('agent-1')
      expect(stats.todaySpent).toBe(0) // reset
      expect(stats.todayCount).toBe(0)
      // monthly should NOT be reset (same month check is based on actual current month)
    })

    it('should reset monthly when month changes', () => {
      const tracker = new Tracker(TMP_DIR)
      tracker.record('agent-1', 50000)

      // Tamper month to simulate last month
      const filePath = join(TMP_DIR, 'context.json')
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      data['agent-1'].monthly.month = '2020-01'
      data['agent-1'].daily.date = '2020-01-15'
      writeFileSync(filePath, JSON.stringify(data), 'utf-8')

      const tracker2 = new Tracker(TMP_DIR)
      const stats = tracker2.getStats('agent-1')
      expect(stats.todaySpent).toBe(0)
      expect(stats.monthSpent).toBe(0)
    })
  })

  describe('file corruption', () => {
    it('should gracefully handle corrupted context.json', () => {
      writeFileSync(join(TMP_DIR, 'context.json'), 'not json!!!', 'utf-8')
      const tracker = new Tracker(TMP_DIR)
      const stats = tracker.getStats('agent-1')
      expect(stats.todaySpent).toBe(0) // fallback to fresh state
    })

    it('should auto-create directory if missing', () => {
      const nested = join(TMP_DIR, 'deep', 'nested', 'dir')
      const tracker = new Tracker(nested)
      tracker.record('agent-1', 100)
      expect(existsSync(join(nested, 'context.json'))).toBe(true)
    })
  })

  describe('persistence', () => {
    it('should persist across Tracker instances', () => {
      const tracker1 = new Tracker(TMP_DIR)
      tracker1.record('agent-1', 1000)
      tracker1.record('agent-1', 2000)

      const tracker2 = new Tracker(TMP_DIR)
      const stats = tracker2.getStats('agent-1')
      expect(stats.todaySpent).toBe(3000)
      expect(stats.monthSpent).toBe(3000)
      expect(stats.todayCount).toBe(2)
    })
  })
})
