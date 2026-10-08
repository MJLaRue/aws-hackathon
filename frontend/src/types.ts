export interface ChatRequest {
  session_id: string
  dataset_id: string
  message: string
  replay_mode?: boolean
}

export interface SourceCall {
  tool: string
  input: Record<string, unknown>
  result_summary: string
  record_ids: string[]
}

export type SSEEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; summary: string }
  | { type: 'grounding_ok' }
  | { type: 'grounding_flag'; failed_values: string[]; message: string }
  | { type: 'warning'; message: string }
  | { type: 'sources'; calls: SourceCall[] }
  | { type: 'error'; message: string }

export const API_BASE: string = import.meta.env.VITE_API_BASE_URL as string

export interface UploadProposal {
  upload_id: string
  dataset_name: string
  source_columns: string[]
  suggestions: Record<string, string | null>
  required_fields: string[]
  unmapped_required: string[]
}

export interface DQFinding { code: string; record_ids: string[]; message: string }

export interface ValidationReport {
  total_rows: number
  rows_accepted: number
  rows_rejected: number
  rows_unmapped_period: number
  rows_excluded_from_totals: number
  rows_synthetic: number
  fiscal_period_range: string
  department_count: number
  category_count: number
  fund_source_count: number
  dq_findings: DQFinding[]
  [k: string]: unknown
}

export interface UploadResult { dataset_id: string; dataset_name: string; report: ValidationReport }

export const CANONICAL_FIELDS = [
  'actual', 'anomaly_review_status', 'approval_cycles', 'budget', 'category', 'confidence_score_1to5',
  'data_entry_errors', 'days_to_produce_report', 'department', 'fiscal_quarter', 'fiscal_year',
  'forecast_accuracy_pct', 'fund_source', 'include_in_totals', 'is_synthetic', 'manual_adjustments_count',
  'month', 'num_spreadsheet_versions', 'prior_year_actual', 'record_id', 'report_status', 'report_type',
  'source_anomaly_flag', 'source_anomaly_type', 'source_forecast', 'source_record_id', 'source_variance',
  'stakeholders_involved', 'variance_pct', 'yoy_change_pct',
] as const

/** Optional fields whose absence disables a view (R1-04). */
export const OPTIONAL_FEATURES: Record<string, string> = {
  fund_source: 'Fund source breakdowns',
  report_type: 'Reporting process health by report type',
  report_status: 'Reporting process health by report status',
  num_spreadsheet_versions: 'Reporting process health metrics',
  days_to_produce_report: 'Reporting process health metrics',
  prior_year_actual: 'Year-over-year comparison checks',
  source_anomaly_flag: 'Source anomaly flag comparison',
  month: 'Monthly grain (quarterly only)',
}

export interface KpiEntityRow {
  entity_level: string; entity_name: string; total_actual: number; total_budget: number
  variance_usd: number; variance_pct_agg: number
}
export interface FiscalYearSummary {
  fiscal_year: string; total_actual: number; total_budget: number; variance_usd: number; variance_pct: number
}
export interface KpiResponse {
  fiscal_year_filter: string | null
  top_over_departments: KpiEntityRow[]; top_under_departments: KpiEntityRow[]
  top_over_categories: KpiEntityRow[]; top_under_categories: KpiEntityRow[]
  total_actual: number; total_budget: number; total_variance_pct: number
  anomaly_count: number; source_flag_disagreement_count: number
  fiscal_year_summary: FiscalYearSummary[]
}

export interface AnomalyRecord {
  record_id: string; department: string; category: string; fiscal_year: string; fiscal_quarter: string
  variance_pct: number; z_score: number; peer_group: string
  detector_reason: 'zscore' | 'abs_floor' | 'both'; severity: 'high' | 'medium' | 'low'
  source_anomaly_flag: number | null; source_anomaly_type: string | null; is_synthetic?: boolean
}
export interface PersistentPattern {
  entity_type: string; entity_name: string; direction: string
  qualifying_years: string[]; per_year_variance: Record<string, number>
}
export interface AnomalyResponse {
  anomalies: AnomalyRecord[]; persistent_patterns: PersistentPattern[]
  confusion_matrix: { tp: number; fp: number; fn: number; tn: number }
  total_records_scanned: number; sensitivity_used: number
}

export interface BenchmarkResponse {
  model_name: string | null; cv_mae: number | null; cv_smape: number | null; n_quarters: number | null
  forecast_target: string; source_rows_compared: number; mean_gap: number | null; max_gap: number | null
  caveat: string | null; inconsistent_variance_records: string[]; inconsistency_warnings: string[]
}

export async function getJSON<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v)
  const res = await fetch(`${API_BASE}${path}?${q}`)
  if (!res.ok) throw new Error(`Request failed (${res.status}).`)
  return (await res.json()) as T
}
export const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
export const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
