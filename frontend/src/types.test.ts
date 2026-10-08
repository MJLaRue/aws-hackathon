import { describe, expect, it } from 'vitest'
import { toCsv } from './types'

describe('toCsv', () => {
  it('neutralises spreadsheet formulas but keeps negative numbers numeric', () => {
    const out = toCsv(['a', 'b', 'c', 'd'], [['=HYPERLINK("x")', '-12.5', '+cmd', 'Library, Main']])
    expect(out.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")",-12.5,'+cmd,"Library, Main"`)
  })
})
