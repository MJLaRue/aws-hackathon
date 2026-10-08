"""Build small test fixtures from the bundled datasets (design §11.3, Rev 5 §0.9).

Outputs (tests/fixtures/):
  test_dataset.xlsx / .csv                 enhanced 30-col schema (~70 rows)
  test_dataset_original_schema.xlsx / .csv original 25-col schema (~60 rows, includes BUD-00018)
Run from the repo root: python scripts/build_fixtures.py
"""
import pandas as pd

ENH = "data/Team6Dataset_Enhanced 1.xlsx"
ORIG = "data/Team6Dataset.xlsx"
OUT = "tests/fixtures"
dims = ["department", "budget_category", "fund_source"]


def cover(df, forced_idx, dims):
    chosen = list(dict.fromkeys(forced_idx))
    covered = {d: set(df.loc[chosen, d].dropna()) for d in dims}
    while any(set(df[d].dropna()) - covered[d] for d in dims):
        best, gain = None, 0
        for i, r in df.iterrows():
            if i in chosen:
                continue
            g = sum(1 for d in dims if pd.notna(r[d]) and r[d] not in covered[d])
            if g > gain:
                best, gain = i, g
        chosen.append(best)
        for d in dims:
            covered[d].add(df.loc[best, d])
    return chosen


def dup_pair(df, idcol):
    """Two distinct records sharing dept+category+FY+FQ with different fund_source."""
    k = ["department", "budget_category", "fiscal_year", "fiscal_quarter"]
    for _, g in df.groupby(k):
        if g[idcol].nunique() > 1 and g.fund_source.nunique() > 1:
            return list(g.drop_duplicates(idcol).index[:2])
    raise SystemExit("no duplicate pair")


def fill_periods(df, chosen):
    for fy in ["FY2024", "FY2025", "FY2026"]:
        for fq in ["Q1", "Q2", "Q3", "Q4"]:
            if not ((df.loc[chosen, "fiscal_year"] == fy) & (df.loc[chosen, "fiscal_quarter"] == fq)).any():
                m = df[(df.fiscal_year == fy) & (df.fiscal_quarter == fq)]
                if len(m):
                    chosen.append(m.index[0])
    return chosen


# --- enhanced -------------------------------------------------------------------
e = pd.read_excel(ENH)
forced = list(e.index[e.source_record_id == "BUD-00018"])
forced += list(e.index[e.variance_pct == -50].tolist()[:2])
forced += list(e.index[~e.include_in_totals][:1])
syn = e[e.is_synthetic].iloc[:3].index.tolist()          # first 3 months of one synthetic series
forced += syn + dup_pair(e[~e.is_synthetic], "source_record_id")
ch = fill_periods(e, cover(e, forced, dims + []))
ch = list(dict.fromkeys(ch))
ch += list(e.drop(index=ch).sample(n=max(0, 66 - len(ch)), random_state=7).index)
fx = e.loc[ch].sort_values("record_id")
fx.to_excel(f"{OUT}/test_dataset.xlsx", index=False)
fx.to_csv(f"{OUT}/test_dataset.csv", index=False)
print("enhanced fixture", fx.shape, fx.department.nunique(), fx.budget_category.nunique(), fx.fund_source.nunique())

# --- original schema ------------------------------------------------------------
o = pd.read_excel(ORIG)
forced = list(o.index[o.record_id == "BUD-00018"]) + o.index[o.variance_pct == -50].tolist()[:2]
forced += dup_pair(o, "record_id")
ch = list(dict.fromkeys(fill_periods(o, cover(o, forced, dims))))
ch += list(o.drop(index=ch).sample(n=max(0, 60 - len(ch)), random_state=7).index)
fo = o.loc[ch].sort_values("record_id")
fo.to_excel(f"{OUT}/test_dataset_original_schema.xlsx", index=False)
fo.to_csv(f"{OUT}/test_dataset_original_schema.csv", index=False)
print("original-schema fixture", fo.shape, fo.department.nunique(), fo.budget_category.nunique(), fo.fund_source.nunique())
