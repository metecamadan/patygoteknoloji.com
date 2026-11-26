"""Aggregate Merchant product issues (no secrets printed)."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

CFG = Path.home() / ".patygo" / "google-api.json"
OUT = Path.home() / ".patygo" / "merchant-issues-report.json"


def token(cfg: dict) -> str:
    creds = Credentials.from_authorized_user_file(cfg["oauthTokenPath"])
    if not creds.valid:
        creds.refresh(Request())
    return creds.token


def reports_search(account: str, tok: str, query: str, page_size: int = 1000) -> list:
    url = f"https://merchantapi.googleapis.com/reports/v1/accounts/{account}/reports:search"
    headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    rows: list = []
    page_token = None
    while True:
        body: dict = {"query": query, "pageSize": page_size}
        if page_token:
            body["pageToken"] = page_token
        r = requests.post(url, headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            print("reports_status", r.status_code, r.text[:500])
            break
        data = r.json()
        rows.extend(data.get("results") or [])
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return rows


def list_products_sample(account: str, tok: str, max_pages: int = 8) -> tuple[Counter, Counter, list]:
    """Walk products; count destination statuses + issue codes; collect image-small samples."""
    headers = {"Authorization": f"Bearer {tok}"}
    url = f"https://merchantapi.googleapis.com/products/v1/accounts/{account}/products"
    dest_counts: Counter = Counter()
    issue_counts: Counter = Counter()
    image_samples: list = []
    page_token = None
    scanned = 0
    for _ in range(max_pages):
        params = {"pageSize": 250}
        if page_token:
            params["pageToken"] = page_token
        r = requests.get(url, headers=headers, params=params, timeout=60)
        if r.status_code != 200:
            print("products_status", r.status_code, r.text[:400])
            break
        data = r.json()
        for p in data.get("products") or []:
            scanned += 1
            status = p.get("productStatus") or {}
            for d in status.get("destinationStatuses") or []:
                ctx = d.get("reportingContext") or "?"
                for key in ("approvedCountries", "pendingCountries", "disapprovedCountries"):
                    countries = d.get(key) or []
                    if countries:
                        dest_counts[f"{ctx}:{key}:{len(countries)}countries"] += 1
                        # coarser bucket
                        short = key.replace("Countries", "")
                        dest_counts[f"bucket:{short}"] += 1
            for issue in status.get("itemLevelIssues") or []:
                code = issue.get("code") or "unknown"
                sev = issue.get("severity") or "?"
                issue_counts[f"{sev}:{code}"] += 1
                code_l = code.lower()
                detail_l = (
                    (issue.get("detail") or "") + " " + (issue.get("description") or "")
                ).lower()
                is_image_small = ("image" in code_l and any(x in code_l for x in ("small", "size", "pixel"))) or (
                    "image" in code_l and "small" in detail_l
                ) or ("too_small" in code_l) or ("image_link_too_small" in code_l)
                if is_image_small and len(image_samples) < 50:
                    attrs = p.get("attributes") or p.get("productAttributes") or {}
                    image_samples.append(
                        {
                            "offerId": p.get("offerId") or attrs.get("offerId"),
                            "title": (attrs.get("title") or "")[:80],
                            "imageLink": attrs.get("imageLink") or attrs.get("image_link"),
                            "code": code,
                            "severity": sev,
                            "detail": (issue.get("detail") or issue.get("description") or "")[:160],
                        }
                    )
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    print("products_scanned", scanned)
    return dest_counts, issue_counts, image_samples


def main() -> int:
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    account = str(cfg["merchantCenterAccountId"])
    tok = token(cfg)

    # Aggregate product statuses
    print("--- aggregateProductStatuses ---")
    agg_url = f"https://merchantapi.googleapis.com/issueresolution/v1/accounts/{account}/aggregateProductStatuses"
    r = requests.get(agg_url, headers={"Authorization": f"Bearer {tok}"}, params={"pageSize": 50}, timeout=60)
    print("agg_status", r.status_code)
    agg = r.json() if r.status_code == 200 else {"raw": r.text[:800]}
    if r.status_code == 200:
        for row in (agg.get("aggregateProductStatuses") or [])[:20]:
            print(
                "agg",
                row.get("reportingContext"),
                "stats",
                json.dumps(row.get("statistics") or {}, ensure_ascii=False)[:200],
            )
            for issue in (row.get("issues") or [])[:8]:
                print(
                    "  issue",
                    issue.get("code"),
                    "sev",
                    issue.get("severity"),
                    "count",
                    (issue.get("stats") or {}).get("activeCount") or issue.get("count"),
                )

    print("--- product_view status counts ---")
    # Try reports for status breakdown
    for status in (
        "ELIGIBLE",
        "ELIGIBLE_LIMITED",
        "NOT_ELIGIBLE_OR_DISAPPROVED",
        "PENDING",
    ):
        q = (
            "SELECT offer_id FROM product_view "
            f"WHERE aggregated_reporting_context_status = '{status}'"
        )
        rows = reports_search(account, tok, q, page_size=1)
        # pageSize 1 still returns total? check next pages roughly via another query
        # Better: count with larger page and stop early
        rows_all = reports_search(account, tok, q, page_size=250)
        print(status, len(rows_all), "(capped if more pages — recount below)")

    print("--- product_view full recount (paginated) ---")
    status_counts: Counter = Counter()
    q = "SELECT offer_id, aggregated_reporting_context_status, title FROM product_view"
    view_rows = reports_search(account, tok, q, page_size=1000)
    for row in view_rows:
        pv = row.get("productView") or row
        status_counts[pv.get("aggregatedReportingContextStatus") or "?"] += 1
    print("product_view_total", len(view_rows))
    for k, v in status_counts.most_common():
        print("status", k, v)

    print("--- issue codes via product_view (if supported) ---")
    q2 = "SELECT offer_id, item_issues FROM product_view WHERE item_issues IS NOT NULL"
    issue_rows = reports_search(account, tok, q2, page_size=250)
    print("rows_with_item_issues_page", len(issue_rows))

    print("--- products.list sample issues ---")
    dest_counts, issue_counts, image_samples = list_products_sample(account, tok, max_pages=20)
    print("dest_top", dest_counts.most_common(15))
    print("issue_top", issue_counts.most_common(25))
    print("image_samples", len(image_samples))
    for s in image_samples[:10]:
        print("  img", s)

    report = {
        "aggregate": agg if r.status_code == 200 else None,
        "productViewStatusCounts": dict(status_counts),
        "productViewTotal": len(view_rows),
        "destCounts": dict(dest_counts),
        "issueCounts": dict(issue_counts.most_common(40)),
        "imageSamples": image_samples,
    }
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
