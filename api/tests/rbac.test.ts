import { describe, it, expect } from 'vitest'
import { hasRole, isAtLeast } from '../src/lib/rbac.js'

describe('RBAC role hierarchy', () => {
  it('owner can do everything', () => {
    expect(isAtLeast('owner', 'admin')).toBe(true)
    expect(isAtLeast('owner', 'member')).toBe(true)
    expect(isAtLeast('owner', 'viewer')).toBe(true)
  })

  it('admin can do admin and below', () => {
    expect(isAtLeast('admin', 'owner')).toBe(false)
    expect(isAtLeast('admin', 'admin')).toBe(true)
    expect(isAtLeast('admin', 'member')).toBe(true)
    expect(isAtLeast('admin', 'viewer')).toBe(true)
  })

  it('member cannot act as admin', () => {
    expect(isAtLeast('member', 'admin')).toBe(false)
    expect(isAtLeast('member', 'member')).toBe(true)
  })

  it('viewer is lowest role', () => {
    expect(isAtLeast('viewer', 'member')).toBe(false)
    expect(isAtLeast('viewer', 'viewer')).toBe(true)
  })
})
