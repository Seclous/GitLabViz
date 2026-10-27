import { getScopedLabelValue, getScopedLabelValues, isScopedLabel } from './scopedLabels'

describe('scopedLabels', () => {
  it('matches prefix capitalization while preserving the value', () => {
    const labels = ['type::Bug', 'TYPE:Feature', 'tYpE::User Story', 'Subtype::Task']
    expect(getScopedLabelValues(labels, 'Type')).toEqual(['Bug', 'Feature', 'User Story'])
    expect(getScopedLabelValue(labels, 'TYPE')).toBe('User Story')
    expect(getScopedLabelValue(['priority::High'], 'Priority')).toBe('High')
  })

  it('extracts scoped label value for both "::" and ":" (prefers last match)', () => {
    const labels = [
      'Component:build&tools',
      'Priority::High',
      'Component:world-editor-tools',
      'Component::engine'
    ]

    expect(getScopedLabelValue(labels, 'Component')).toBe('engine')
    expect(getScopedLabelValue(labels, 'Priority')).toBe('High')
  })

  it('extracts all scoped label values (in order, de-duped)', () => {
    const labels = [
      'Status::Todo',
      'Status::In Progress',
      'Status::Todo',
      'Status:Blocked',
      'Other::X'
    ]
    expect(getScopedLabelValues(labels, 'Status')).toEqual(['Todo', 'In Progress', 'Blocked'])
  })

  it('returns null for missing/invalid inputs', () => {
    expect(getScopedLabelValue(null, 'Component')).toBe(null)
    expect(getScopedLabelValue([], 'Component')).toBe(null)
    expect(getScopedLabelValue(['Component:foo'], '')).toBe(null)
  })

  it('isScopedLabel recognises Prefix::Value / Prefix:Value vs plain labels', () => {
    expect(isScopedLabel('Priority::High')).toBe(true)
    expect(isScopedLabel('Type:Bug')).toBe(true)
    expect(isScopedLabel('Component::core engine')).toBe(true)
    expect(isScopedLabel('Bug')).toBe(false)
    expect(isScopedLabel('Frontend')).toBe(false)
    expect(isScopedLabel(':foo')).toBe(false)
    expect(isScopedLabel('foo:')).toBe(false)
    expect(isScopedLabel('')).toBe(false)
    expect(isScopedLabel(null)).toBe(false)
    expect(isScopedLabel(undefined)).toBe(false)
  })

})

