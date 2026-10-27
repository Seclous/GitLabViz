import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { credentialFingerprint } from './credentialFingerprint'
import { relativeToGroup } from './relativeToGroup'
import { assembleRelationships } from './issueRelationships'

describe('review regressions', () => {
  it('partitions credentials using SHA-256 without storing the token', () => {
    for (const token of ['', 'abc', 'a'.repeat(200), '🔑token']) {
      expect(credentialFingerprint(token)).toBe(createHash('sha256').update(token).digest('hex'))
    }
  })
  it('shortens only descendants at a namespace boundary', () => {
    expect(relativeToGroup('example-team/example-group/api#42', 'example-team/example-group')).toBe('api#42')
    expect(relativeToGroup('example-team/example-group', 'example-team/example-group')).toBe('example-team/example-group')
    expect(relativeToGroup('example-team/example-group-extra/api#42', 'example-team/example-group')).toBe('example-team/example-group-extra/api#42')
    expect(relativeToGroup('other/example-group/api#42', 'example-team/example-group')).toBe('other/example-group/api#42')
  })
  it('distinguishes unindexed same-group context from outside-group endpoints', () => {
    const nodes = { 'issue:1': { id: 'issue:1', type: 'gitlab_issue' } }
    const observations = { 'issue:1': { links: [2, 3].map(id => ({ id, project_id: id, iid: 42, title: 'Context', link_type: 'blocks' })) } }
    const { external } = assembleRelationships(nodes, observations, { projectDirectory: { 2: { id: 2 } } })
    expect(external['issue:2']).toMatchObject({ outsideSelectedGroup: false, inSelectedGroup: true, notInIndex: true, readOnly: true })
    expect(external['issue:3']).toMatchObject({ outsideSelectedGroup: true, inSelectedGroup: false, notInIndex: true, readOnly: true })
  })
})
