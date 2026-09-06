"""One-off: REPLACE the "Infollion Research" segmentation tree with the MySQL
`domains` table (agreed Sep 06 2026 — MySQL is the source of truth; the
legacy Excel-imported nodes are dropped; no rename propagation).

Run from /app/backend:  python scripts/replace_infollion_from_domains.py
Subsequent syncs run automatically in `merge` mode inside crm_sync.run_full_sync.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from domain_sync import sync_domains  # noqa: E402


async def main():
    res = await sync_domains(mode="replace")
    print(json.dumps(res, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
