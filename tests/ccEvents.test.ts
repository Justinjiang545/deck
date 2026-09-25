import { HOOK_EVENTS, isHookEventName, lastMessageFrom, nextCc, sessionIdFrom } from '../src/main/ccEvents'

describe('isHookEventName', () => {
  it('accepts only the known set', () => {
    for (const e of HOOK_EVENTS) expect(isHookEventName(e)).toBe(true)
    expect(isHookEventName('PreToolUse')).toBe(false)
    expect(isHookEventName(42)).toBe(false)
    expect(isHookEventName(undefined)).toBe(false)
  })
})

describe('sessionIdFrom / lastMessageFrom', () => {
  it('reads snake_case or camelCase session id', () => {
    expect(sessionIdFrom({ session_id: 'abc' })).toBe('abc')
    expect(sessionIdFrom({ sessionId: 'def' })).toBe('def')
    expect(sessionIdFrom({})).toBeUndefined()
    expect(sessionIdFrom(null)).toBeUndefined()
    expect(sessionIdFrom('not an object')).toBeUndefined()
  })

  it('extracts and truncates a last-message snippet', () => {
    expect(lastMessageFrom({ last_assistant_message: 'hi there' })).toBe('hi there')
    expect(lastMessageFrom({ message: 'fallback' })).toBe('fallback')
    expect(lastMessageFrom({ transcript_tail: 'tail' })).toBe('tail')
    expect(lastMessageFrom({})).toBeUndefined()
    const long = 'x'.repeat(600)
    expect(lastMessageFrom({ last_assistant_message: long })?.length).toBe(500)
  })
})

describe('nextCc', () => {
  it('SessionStart opens cc idle with the session id', () => {
    expect(nextCc(null, 'SessionStart', { session_id: 's1' }, false)).toEqual({ sessionId: 's1', status: 'idle', unseen: false })
  })

  it('SessionEnd clears cc', () => {
    expect(nextCc({ status: 'working', unseen: false }, 'SessionEnd', {}, false)).toBeNull()
  })

  it('UserPromptSubmit sets working and clears unseen/attention, keeps sessionId and lastMessage', () => {
    const prev = { sessionId: 's1', status: 'needs-you' as const, attention: 'done' as const, unseen: true, lastMessage: 'old' }
    expect(nextCc(prev, 'UserPromptSubmit', {}, false)).toEqual({ sessionId: 's1', status: 'working', unseen: false, lastMessage: 'old' })
  })

  it('Stop sets needs-you/done and unseen unless visible', () => {
    expect(nextCc(null, 'Stop', { last_assistant_message: 'done!' }, false)).toEqual({
      sessionId: undefined, status: 'needs-you', attention: 'done', unseen: true, lastMessage: 'done!'
    })
    expect(nextCc(null, 'Stop', {}, true)).toMatchObject({ status: 'needs-you', attention: 'done', unseen: false })
  })

  it('Notification sets needs-you/input and unseen unless visible, preserves lastMessage', () => {
    const prev = { sessionId: 's1', status: 'working' as const, unseen: false, lastMessage: 'keep me' }
    expect(nextCc(prev, 'Notification', {}, false)).toEqual({ sessionId: 's1', status: 'needs-you', attention: 'input', unseen: true, lastMessage: 'keep me' })
    expect(nextCc(prev, 'Notification', {}, true)!.unseen).toBe(false)
  })

  it('a later event without a session_id keeps the previous sessionId', () => {
    const prev = { sessionId: 's1', status: 'working' as const, unseen: false }
    expect(nextCc(prev, 'Stop', {}, false)?.sessionId).toBe('s1')
  })
})
