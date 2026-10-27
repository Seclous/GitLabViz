import { enrichIssueCustomFieldsFromGraphql, enrichIssuesFromGraphql } from './gitlab'

const customFieldsResponse = (fields) => ({ data: { data: { namespace: {
  item0: { widgets: [{ customFieldValues: fields }] }
} } } })

describe('GitLab custom-field enrichment', () => {
  it.each(['http', 'graphql'])('splits batches rejected by %s query limits', async mode => {
    const client = { post: vi.fn(async (_, { variables }) => {
      if (variables.iid1) {
        if (mode === 'http') throw Object.assign(new Error('Too complex'), { response: { status: 422 } })
        return { data: { errors: [{ message: 'Query complexity exceeds limit' }] } }
      }
      return customFieldsResponse([{ customField: { name: 'Priority' }, selectedOptions: [{ value: variables.iid0 }] }])
    }) }
    const issues = [{ iid: 1 }, { iid: 2 }, { iid: 3 }]
    await enrichIssueCustomFieldsFromGraphql(client, 'group/project', issues)
    expect(issues.map(issue => issue.custom_field_values[0].selected_options[0].value)).toEqual(['1', '2', '3'])
    expect(client.post).toHaveBeenCalledTimes(5)
  })

  it('loads select, text, and number values through work-item widgets', async () => {
    const client = { post: vi.fn().mockResolvedValue(customFieldsResponse([
      { customField: { name: 'Priority' }, selectedOptions: [{ value: 'High' }] },
      { customField: { name: 'Notes' }, textValue: 'Some text' },
      { customField: { name: 'Score' }, numberValue: 0 }
    ])) }
    const issues = [{ iid: 7, labels: ['Priority::Low'] }]
    await enrichIssueCustomFieldsFromGraphql(client, 'group/project', issues)
    expect(client.post).toHaveBeenCalledWith('', expect.objectContaining({
      query: expect.stringContaining('namespace(fullPath: $fullPath)'),
      variables: { fullPath: 'group/project', iid0: '7' }
    }), expect.anything())
    expect(issues[0].custom_field_values).toEqual([
      { custom_field: { name: 'Priority' }, selected_options: [{ value: 'High' }] },
      { custom_field: { name: 'Notes' }, value: 'Some text' },
      { custom_field: { name: 'Score' }, value: 0 }
    ])
  })

  it('resolves numeric project IDs and batches lookups', async () => {
    const client = { post: vi.fn()
      .mockResolvedValueOnce({ data: { data: { node: { fullPath: 'group/project' } } } })
      .mockResolvedValue(customFieldsResponse([])) }
    const issues = [{ iid: 1 }, { iid: 2 }]
    await enrichIssueCustomFieldsFromGraphql(client, 42, issues, null, { customFieldsBatchSize: 1 })
    expect(client.post.mock.calls[0][1].variables).toEqual({ id: 'gid://gitlab/Project/42' })
    expect(client.post.mock.calls.slice(1).map(call => call[1].variables)).toEqual([
      { fullPath: 'group/project', iid0: '1' },
      { fullPath: 'group/project', iid0: '2' }
    ])
    expect(issues.every(issue => Array.isArray(issue.custom_field_values))).toBe(true)
  })

  it('leaves label fallback intact and stops retrying unsupported schemas', async () => {
    const client = { post: vi.fn().mockResolvedValue({ data: { errors: [{
      message: "No such type WorkItemWidgetCustomFields", extensions: { code: 'undefinedType' }
    }] } }) }
    const issues = [{ iid: 1, labels: ['Priority::High'] }]
    await enrichIssueCustomFieldsFromGraphql(client, 'group/project', issues)
    await enrichIssueCustomFieldsFromGraphql(client, 'group/project', issues)
    expect(client.post).toHaveBeenCalledTimes(1)
    expect(issues[0]).toEqual({ iid: 1, labels: ['Priority::High'] })
  })

  it('clears removed custom-field values after a successful lookup', async () => {
    const client = { post: vi.fn().mockResolvedValue(customFieldsResponse([])) }
    const issues = [{ iid: 1, custom_field_values: [{ custom_field: { name: 'Priority' }, value: 'High' }] }]
    await enrichIssueCustomFieldsFromGraphql(client, 'group/project', issues)
    expect(issues[0].custom_field_values).toEqual([])
  })

  it('enriches custom fields even when no legacy issue fields are supported', async () => {
    const client = {
      __glvIssueFieldCaps: { _probeDone: true },
      post: vi.fn().mockResolvedValue(customFieldsResponse([
        { customField: { name: 'Priority' }, selectedOptions: [{ value: 'High' }] }
      ]))
    }
    const issues = [{ iid: 1 }]
    await enrichIssuesFromGraphql(client, 'group/project', issues)
    expect(issues[0].custom_field_values[0].selected_options).toEqual([{ value: 'High' }])
  })
})
