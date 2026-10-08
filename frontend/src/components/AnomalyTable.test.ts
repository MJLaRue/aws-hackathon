import { describe, expect, it } from 'vitest'
import { groupAnomalies, sortGroups } from './AnomalyTable'
import type { AnomalyRecord } from '../types'

const row = (id: string, o: Partial<AnomalyRecord> = {}): AnomalyRecord => ({
  record_id: id, department: 'Library', category: 'Travel', fiscal_year: 'FY2025', fiscal_quarter: 'Q1', variance_pct: 10, z_score: 3,
  peer_group: 'category', detector_reason: 'both', severity: 'medium', source_anomaly_flag: 1, source_anomaly_type: 'Overrun', ...o,
})

describe('groupAnomalies', () => {
  const rows = [row('M-1', { variance_pct: -50, severity: 'high' }), row('M-2', { variance_pct: -49, severity: 'medium' }), row('M-3', { fiscal_quarter: 'Q2' })]

  it('merges records from the same department, category and quarter', () => {
    const g = groupAnomalies(rows, true)
    expect(g).toHaveLength(2)
    const q1 = g.find((x) => x.fiscal_quarter === 'Q1')!
    expect(q1.rows.map((r) => r.record_id)).toEqual(['M-1', 'M-2'])
    expect(q1.severity).toBe('high')
    expect(q1.variance_pct).toBe(-50)
  })

  it('keeps one line per record when grouping is off', () => {
    expect(groupAnomalies(rows, false)).toHaveLength(3)
  })

  it('sorts by severity then magnitude, and flips with direction', () => {
    const g = groupAnomalies(rows, true)
    expect(sortGroups(g, 'severity', -1)[0].severity).toBe('high')
    expect(sortGroups(g, 'severity', 1)[0].severity).toBe('medium')
    expect(sortGroups(g, 'variance', -1)[0].variance_pct).toBe(-50)
  })
})
