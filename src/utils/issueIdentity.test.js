import { describe, it, expect } from 'vitest'
import fixture from '../../fixtures/group-baseline.json'
import { issueKey, normalizeIssueIdentity, issueReference, createIssueLookup, migrateIssueSelection } from './issueIdentity'
import { slimIssue } from '../composables/useDataLoader'
const source = { kind: 'group', idOrPath: fixture.group }
const projects = Object.fromEntries(fixture.projects.map(p => [p.id, p]))
const makeNodes = () => Object.fromEntries(fixture.issues.map(raw => { const n = { ...normalizeIssueIdentity(raw, source, projects), type: 'gitlab_issue', _raw: slimIssue(raw) }; return [n.id, n] }))
describe('cross-project issue identity', () => {
  it('keeps duplicate IIDs distinct through export and reload', () => {
    const nodes = JSON.parse(JSON.stringify(makeNodes()))
    expect(nodes['issue:1001'].iid).toBe(42)
    expect(nodes['issue:2001'].iid).toBe(42)
    expect(issueReference(nodes['issue:1001'], true)).toBe('example/core/app#42')
    expect(issueReference(nodes['issue:2001'], true)).toBe('example/core/sub/api#42')
    expect(nodes['issue:1001']._raw.project_id).toBe(101)
  })
  it('resolves project-qualified identities without a bare IID fallback', () => {
    const lookup = createIssueLookup(makeNodes())
    expect(lookup.resolve({ project_id: 102, iid: 42 })).toBe('issue:2001')
    expect(lookup.resolve({ iid: 42 })).toBeNull()
    expect(issueKey({ project_id: 102, iid: 42 })).toBe('project:102:issue:42')
  })
  it('migrates legacy selection only for an unambiguous project', () => {
    const nodes = makeNodes()
    expect(migrateIssueSelection(['42'], nodes, 'group')).toEqual([])
    expect(migrateIssueSelection(['42'], nodes, 'project')).toEqual(['42'])
    expect(migrateIssueSelection(['42'], { 'issue:1001': nodes['issue:1001'] }, 'project')).toEqual(['issue:1001'])
  })
})
