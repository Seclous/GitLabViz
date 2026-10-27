import { getIssuePriority, getIssuePriorityValues } from './issueFields'

describe('issue priority', () => {
  it('prefers a custom Priority field over scoped labels regardless of name capitalization', () => {
    const raw = {
      labels: ['Priority::Low'],
      custom_field_values: [
        { custom_field: { name: 'Other' }, selected_options: [{ value: 'Ignore' }] },
        { custom_field: { name: 'pRiOrItY' }, selected_options: [{ value: 'High' }] }
      ]
    }
    expect(getIssuePriority(raw)).toBe('High')
    expect(getIssuePriorityValues(raw)).toEqual(['High'])
  })

  it('accepts text and numeric custom-field values including zero', () => {
    expect(getIssuePriority({ custom_field_values: [{ custom_field: { name: 'Priority' }, value: 'Critical' }] })).toBe('Critical')
    expect(getIssuePriority({ custom_field_values: [{ custom_field: { name: 'Priority' }, value: 0 }] })).toBe('0')
  })

  it('deduplicates selected values and uses the last value for a single priority', () => {
    const raw = { custom_field_values: [{ custom_field: { name: 'Priority' }, selected_options: [{ value: 'High' }, { value: 'Low' }, { value: 'High' }] }] }
    expect(getIssuePriorityValues(raw)).toEqual(['High', 'Low'])
    expect(getIssuePriority(raw)).toBe('Low')
  })

  it('falls back to scoped labels when the custom field is absent or empty', () => {
    for (const custom_field_values of [undefined, [], [{ custom_field: { name: 'Priority' }, selected_options: [] }], [{ custom_field: { name: 'Priority' }, value: ' ' }]]) {
      expect(getIssuePriority({ labels: ['priority::High'], custom_field_values })).toBe('High')
    }
    expect(getIssuePriority()).toBeNull()
  })
})
