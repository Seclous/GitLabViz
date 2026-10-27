import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import fixture from '../../fixtures/group-baseline.json'
import { useGraphDerivedState } from './useGraphDerivedState'
import { normalizeIssueIdentity } from '../utils/issueIdentity'

function projectState(patch = {}, group = false) {
  const filters = {
    includeClosed: true, selectedStatuses: [], selectedSubscription: null,
    selectedLabels: [], excludedLabels: [], selectedAuthors: [], selectedAssignees: [],
    selectedMilestones: [], selectedPriorities: [], selectedTypes: [], mrMode: null,
    selectedParticipants: [], dueStatus: null, spentMode: null, budgetMode: null,
    estimateBucket: null, taskMode: null, searchQuery: '',
    dateFilters: { createdMode: 'none', updatedMode: 'none', dueDateMode: 'none' }, ...patch
  }
  const nodes = Object.fromEntries(fixture.issues.filter(issue => group || issue.project_id === 101)
    .map(issue => {
      const identity = normalizeIssueIdentity(issue, { kind: group ? 'group' : 'project', idOrPath: group ? 'example/core' : '101' })
      const id = group ? identity.id : String(issue.iid)
      return [id, { ...identity, id, name: issue.title, _raw: issue }]
    }))
  return useGraphDerivedState({
    settings: reactive({ config: { gitlabSourceKind: group ? 'group' : 'project' }, meta: {}, uiState: { filters, view: {
      linkMode: 'none', groupingMode: 'none', dueSoonDays: 7, hideUnlinked: false
    } } }), nodes, edges: {}
  })
}

describe('committed project-mode baseline', () => {
  it('lists both project issues, including the closed issue', () => {
    expect(Object.keys(projectState().filteredNodes.value).sort()).toEqual(['42', '43'])
    expect(Object.keys(projectState({ includeClosed: false }).filteredNodes.value)).toEqual(['42'])
  })
  it('uses case-insensitive Priority custom fields before the label fallback', () => {
    expect(Object.keys(projectState({ selectedPriorities: ['Critical'] }).filteredNodes.value)).toEqual(['42'])
    expect(Object.keys(projectState({ selectedPriorities: ['Low'] }).filteredNodes.value)).toEqual(['43'])
  })
  it('recognizes mixed-case Type label prefixes and combines filters', () => {
    expect(Object.keys(projectState({ selectedTypes: ['Bug'] }).filteredNodes.value)).toEqual(['42'])
    expect(Object.keys(projectState({ selectedTypes: ['Feature'], selectedPriorities: ['Critical'] }).filteredNodes.value)).toEqual([])
  })
})


describe('group identity search', () => {
  it('keeps duplicate IIDs and matches a fully qualified reference', () => {
    expect(Object.keys(projectState({ searchQuery: '42' }, true).filteredNodes.value).sort()).toEqual(['issue:1001', 'issue:2001', 'issue:4001'])
    expect(Object.keys(projectState({ searchQuery: 'example/core/sub/api#42' }, true).filteredNodes.value)).toEqual(['issue:2001'])
  })
})
