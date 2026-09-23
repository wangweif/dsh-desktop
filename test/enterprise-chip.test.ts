import { describe, expect, it } from 'vitest'
import { enterpriseAvatarLetter, enterpriseDisplayName } from '../src/preload/enterprise-chip'

const baseUser = {
  id: 'u1',
  username: 'admin',
  nickname: null,
  email: null,
  role: 'super_admin',
  tenantId: null,
  tenantName: null
}

describe('enterprise chip display helpers', () => {
  it('prefers the nickname over the username', () => {
    expect(enterpriseDisplayName({ ...baseUser, nickname: '王卫' })).toBe('王卫')
    expect(enterpriseDisplayName(baseUser)).toBe('admin')
  })

  it('falls back to the username when the nickname is blank', () => {
    expect(enterpriseDisplayName({ ...baseUser, nickname: '' })).toBe('admin')
  })

  it('takes the first character as the avatar letter', () => {
    expect(enterpriseAvatarLetter({ ...baseUser, nickname: '王卫' })).toBe('王')
    expect(enterpriseAvatarLetter({ ...baseUser, username: 'admin' })).toBe('A')
  })

  it('handles empty names', () => {
    const empty = { ...baseUser, username: '', nickname: '' }
    expect(enterpriseDisplayName(empty)).toBe('?')
    expect(enterpriseAvatarLetter(empty)).toBe('?')
  })
})
