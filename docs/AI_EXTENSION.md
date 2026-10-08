# Adding the AI layer

The application includes the financial record system and separate historical workbook analytics from `Dev_HV`. Workbook forecasting, anomaly review, and scenarios are available through **Forecasting & scenarios**; see [integration notes](INTEGRATION.md). Language-model explanations and forecasts based on live MySQL workspace records are not implemented. The following guidance applies to that future live-record AI layer.

Add forecasting/explanation services beside the finance services. Reuse authenticated context, resource permissions and department scopes. Use `matrix()` plus dated, non-deleted expenses as the authoritative baseline. Salary access is separately required; aggregate before external model calls. Do not send UINs, SAML/session records, or unscoped audit history to a model.

Compute numerical forecasts and scenario totals deterministically. Return the method, observation window, historical coverage, horizon, assumptions and uncertainty. A language model can explain these computed results with traceable department/account/year references. It must not invent missing actuals or reconcile illustrative salary rosters against a full personnel budget.

Future flows:

1. Forecast fiscal-year expenses and compare against an explicitly labeled opening or adjusted budget.
2. Flag unusual recorded spending for human review, considering timing and one-time expenses.
3. Compare hiring, inflation, funding or timing scenarios in a separate scenario store.
4. Explain the largest forecast variances using structured calculation output and source records.

Keep AI output read-only by default. Proposed financial adjustments must use the same human review, permission checks, draft conflicts and audit path as ordinary edits. Add versioned migrations for forecast runs/scenarios rather than changing existing budget-table meaning. Shared budget drafts have real publication semantics and must not be silently populated/published by AI.
