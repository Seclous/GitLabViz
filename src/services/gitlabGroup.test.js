import { describe, it, expect, vi } from 'vitest'
import { fetchGroupProjects, fetchGroupIssuesRest } from './gitlab'

const source = { kind: 'group', idOrPath: 'team/core', includeSubgroups: true, includeShared: false }
const issue = (id, project_id, iid = 42) => ({ id, project_id, iid, state: 'opened', references: { full: 'team/p' + project_id + '#' + iid } })

describe('group ingestion', () => {
  it('paginates the project directory without exposed pagination headers and forwards membership options', async () => {
    const projects = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 }))
    const client = { get: vi.fn(async (_url, { params }) => ({ data: projects.slice((params.page - 1) * 100, params.page * 100), headers: {} })) }
    const directory = await fetchGroupProjects(client, source)
    expect(Object.keys(directory)).toHaveLength(101)
    expect(client.get).toHaveBeenCalledTimes(2)
    expect(client.get.mock.calls[0][0]).toBe('/groups/team%2Fcore/projects')
    expect(client.get.mock.calls[0][1].params).toMatchObject({ include_subgroups: true, with_shared: false })
  })

  it('keeps identical IIDs from different projects and excludes projects outside the directory', async () => {
    const client = { get: vi.fn(async () => ({ data: [issue(11, 1), issue(22, 2), issue(33, 3)], headers: { 'x-next-page': '' } })) }
    const result = await fetchGroupIssuesRest(client, source, { 1: { id: 1, open_issues_count: 1 }, 2: { id: 2, open_issues_count: 1 } })
    expect(result.map(i => i.id)).toEqual([11, 22])
    expect(client.get).toHaveBeenCalledTimes(1)
  })

  it('checks missing project coverage and deduplicates group and project responses', async () => {
    const client = { get: vi.fn(async url => ({ data: url.startsWith('/groups/') ? [issue(11, 1)] : [issue(11, 1), issue(12, 1, 43)], headers: { 'x-next-page': '' } })) }
    const result = await fetchGroupIssuesRest(client, source, { 1: { id: 1, open_issues_count: 2 } })
    expect(result.map(i => i.id)).toEqual([11, 12])
    expect(client.get.mock.calls[1][0]).toBe('/projects/1/issues')
  })

  it('paginates group issues without exposed headers and marks interrupted coverage as partial', async () => {
    const items = Array.from({ length: 100 }, (_, i) => issue(i + 1, 1, i + 1))
    const client = { get: vi.fn(async (_url, { params }) => {
      if (params.page === 2) throw new Error('interrupted')
      return { data: items, headers: {} }
    }) }
    const result = await fetchGroupIssuesRest(client, source, { 1: { id: 1, open_issues_count: 100 } })
    expect(result).toHaveLength(100)
    expect(result.__glvPartial).toBe(true)
    expect(client.get).toHaveBeenCalledTimes(2)
  })
})
