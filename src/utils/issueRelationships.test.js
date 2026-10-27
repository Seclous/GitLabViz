import { describe, it, expect } from 'vitest'
import { assembleRelationships, canonicalRelationship, dependencySummary } from './issueRelationships'
const issue = (id, project, state = 'opened') => ({ id: 'issue:' + id, type: 'gitlab_issue', projectId: project, iid: 7, state })
describe('canonical issue relationships', () => {
  it('deduplicates both endpoints across projects with identical IIDs into one directed edge', () => {
    const nodes = { 'issue:1': issue(1, 10), 'issue:2': issue(2, 20) }
    const result = assembleRelationships(nodes, {
      'issue:1': { links: [{ id: 2, project_id: 20, iid: 7, link_type: 'blocks', issue_link_id: 90 }] },
      'issue:2': { links: [{ id: 1, project_id: 10, iid: 7, link_type: 'is_blocked_by', issue_link_id: 90 }] }
    })
    expect(Object.values(result.edges)).toEqual([{ id: 'issue-link:90', source: 'issue:1', target: 'issue:2', label: 'blocks', kind: 'issue_link', issueLinkId: 90 }])
    expect([...dependencySummary(nodes, result.edges).blocked]).toEqual(['issue:2'])
    nodes['issue:1'].state = 'closed'
    expect(dependencySummary(nodes, result.edges).blocked.size).toBe(0)
    expect(dependencySummary(nodes, result.edges).inactive).toBe(1)
    delete nodes['issue:1'].state
    expect([...dependencySummary(nodes, result.edges).unknown]).toEqual(['issue:2'])
  })
  it('normalizes related links without directional arrows and fallback block IDs', () => {
    expect(canonicalRelationship('b', 'a', { link_type: 'relates_to' })).toMatchObject({ source: 'a', target: 'b', label: 'relates' })
    expect(canonicalRelationship('b', 'a', { link_type: 'is_blocked_by' }).id).toBe(canonicalRelationship('a', 'b', { link_type: 'blocks' }).id)
  })
  it('bounds external nodes to actual endpoint data, reporting inaccessible endpoints', () => {
    const links = [
      { id: 2, project_id: 20, iid: 7, title: 'Actual endpoint', state: 'opened', link_type: 'blocks' },
      { id: 3, project_id: 30, iid: 7, link_type: 'blocks' },
      { id: 4, project_id: 40, iid: 7, title: 'Beyond budget', link_type: 'blocks' }
    ]
    const result = assembleRelationships({ 'issue:1': issue(1, 10) }, { 'issue:1': { links } }, { maxExternal: 1 })
    expect(Object.keys(result.external)).toEqual(['issue:2'])
    expect(result.external['issue:2']).toMatchObject({ externalContext: true, inSelectedGroup: false, title: 'Actual endpoint' })
    expect(result.diagnostics).toMatchObject({ missing: 1, externalOmitted: 1 })
    expect(Object.values(result.edges)).toHaveLength(1)
  })
  it('does not create orphan context for unsupported links or exhausted edge budgets', () => {
    const nodes = { 'issue:1': issue(1, 10) }
    const observations = { 'issue:1': { links: [{ id: 2, project_id: 20, iid: 7, title: 'External', link_type: 'unsupported' }] } }
    expect(assembleRelationships(nodes, observations).external).toEqual({})
    observations['issue:1'].links[0].link_type = 'blocks'
    expect(assembleRelationships(nodes, observations, { maxEdges: 0 }).external).toEqual({})
    expect(dependencySummary({ 'issue:1': { ...issue(1, 10), priority: 'Critical' } }, {}).blocked.size).toBe(0)
  })

  it('follows observed external endpoints for a second hop without using orphan observations', () => {
    const nodes = { 'issue:1': issue(1, 10) }
    const link = (id, project) => ({ id, project_id: project, iid:7, title:'Authorized endpoint', state:'opened', link_type:'blocks' })
    const observations = { 'issue:1':{links:[link(2,20)]}, 'issue:2':{links:[link(3,30)]}, 'issue:99':{links:[link(100,100)]} }
    expect(Object.keys(assembleRelationships(nodes, observations).external)).toEqual(['issue:2'])
    const result = assembleRelationships(nodes, observations, {maxHops:2})
    expect(Object.keys(result.external)).toEqual(['issue:2','issue:3'])
    expect(Object.values(result.edges)).toHaveLength(2)
  })
})
