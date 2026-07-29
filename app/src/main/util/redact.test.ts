import { describe, expect, it } from 'vitest'
import { redactDeep, redactText } from './redact'
import { projectNameFromCwd } from './project'

describe('redactText', () => {
  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redactText(`token=${jwt}`)).toContain('[REDACTED_JWT]')
  })

  it('masks emails', () => {
    expect(redactText('user@example.com')).toMatch(/us\*\*\*@example\.com/)
  })
})

describe('redactDeep', () => {
  it('redacts token keys', () => {
    const out = redactDeep({ access_token: 'secret-value', plan: 'plus' })
    expect(out.access_token).toBe('[REDACTED]')
    expect(out.plan).toBe('plus')
  })
})

describe('projectNameFromCwd', () => {
  it('returns basename only', () => {
    expect(projectNameFromCwd('C:\\Projects\\Grok Build\\Dashboard')).toBe('Dashboard')
    expect(projectNameFromCwd('/home/dev/streamfinder-next')).toBe('streamfinder-next')
  })

  it('handles empty', () => {
    expect(projectNameFromCwd(null)).toBe('unknown')
    expect(projectNameFromCwd('')).toBe('unknown')
  })
})
