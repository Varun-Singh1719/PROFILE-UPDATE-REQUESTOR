"""ONE-OFF TEST DATA SCRIPT (Sep 06 2026) — NOT an automation.

Populate Client Contact Industries (hierarchical Infollion paths) from the MySQL
`projects` table (mirrored in Mongo `mysql_projects`):

    project.client_contacts  → which contact(s) the project belongs to
    project.l0_domain / l1_domain / l2_domain / l3_domain → Domains ids
                                                            (= tree ext_ids)

For every app client contact linked to MySQL (`mysql_ref.mysql_id`) we collect
the DISTINCT (l0, l1, l2, l3) chains of its projects, validate them against the
Infollion Research tree (`routers/industry_paths.resolve_paths`) and write
`industry_paths` + derived `industries` (legacy free-text strings are dropped —
they were placeholders). Each change is recorded on the contact Timeline as
"System (data migration)".

Usage (from /app/backend):
    python scripts/backfill_contact_industries_from_projects.py            # dry run
    python scripts/backfill_contact_industries_from_projects.py --apply    # write

When the system goes live users will maintain Industries manually in the form.
"""
import asyncio
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from core import db  # noqa: E402
from routers.industry_paths import load_nodes, labels_of, SEP  # noqa: E402
from routers.client_contact_timeline import record_entries  # noqa: E402

SYSTEM_USER = {"id": "system:data-migration", "name": "System (data migration)", "email": None, "emp_id": None}


def _chain(p):
    ids = []
    for k in ("l0_domain", "l1_domain", "l2_domain", "l3_domain"):
        v = p.get(k)
        if v is None:
            break
        try:
            ids.append(int(v))
        except (TypeError, ValueError):
            break
    return tuple(ids)


def resolve_local(nodes, ids):
    """Same rules as routers.industry_paths.resolve_paths, but against a
    pre-loaded node map (no DB round-trip per chain)."""
    names, shorts = [], []
    for depth, ext in enumerate(ids):
        n = nodes.get(ext)
        if not n or n["level"] != depth:
            return None
        if n["parent_ext_id"] != (ids[depth - 1] if depth else None):
            return None
        names.append(n["name"])
        shorts.append(n["short"])
    return {"ext_ids": list(ids), "names": names, "shorts": shorts, "label": SEP.join(shorts)}


async def main(apply: bool):
    nodes = (await load_nodes())["nodes"]
    print(f"Infollion tree nodes: {len(nodes)}")

    # mysql contact id → set of distinct domain chains
    chains_by_mysql = defaultdict(set)
    async for p in db["mysql_projects"].find(
        {}, {"_id": 0, "client_contact_ids": 1, "l0_domain": 1, "l1_domain": 1, "l2_domain": 1, "l3_domain": 1}
    ):
        ch = _chain(p)
        if not ch:
            continue
        for cid in p.get("client_contact_ids") or []:
            chains_by_mysql[int(cid)].add(ch)
    print(f"MySQL contacts with project domains: {len(chains_by_mysql)}")

    updated = skipped_invalid = unchanged = no_projects = 0
    async for c in db["client_contacts"].find(
        {}, {"_id": 0, "id": 1, "name": 1, "mysql_ref.mysql_id": 1, "industries": 1, "industry_paths": 1}
    ):
        mid = (c.get("mysql_ref") or {}).get("mysql_id")
        if mid is None or int(mid) not in chains_by_mysql:
            no_projects += 1
            continue
        chains = sorted(chains_by_mysql[int(mid)])
        valid = []
        for ch in chains:
            path = resolve_local(nodes, ch)
            if path is None:
                skipped_invalid += 1
                if skipped_invalid <= 10:
                    print(f"  ! {c['name']}: chain {ch} skipped — not a valid Infollion path")
            else:
                valid.append(path)
        # de-dup (resolve_paths de-dups within a call only)
        seen, paths = set(), []
        for p in valid:
            k = tuple(p["ext_ids"])
            if k not in seen:
                seen.add(k)
                paths.append(p)
        new_labels = labels_of(paths)
        old_labels = c.get("industries") or []
        if new_labels == old_labels and (c.get("industry_paths") or []) == paths:
            unchanged += 1
            continue
        updated += 1
        if updated <= 5:
            print(f"  {c['name']}: {old_labels} -> {new_labels}")
        if apply:
            await db["client_contacts"].update_one(
                {"id": c["id"]}, {"$set": {"industry_paths": paths, "industries": new_labels}}
            )
            changes = [{"field": "industries", "action": "deleted", "previous_value": o, "new_value": None}
                       for o in old_labels if o not in new_labels]
            changes += [{"field": "industries", "action": "added", "previous_value": None, "new_value": n}
                        for n in new_labels if n not in old_labels]
            if changes:
                await record_entries(c["id"], SYSTEM_USER, changes, event="updated")

    print(f"\n{'APPLIED' if apply else 'DRY RUN'}: updated={updated} unchanged={unchanged} "
          f"no_mysql_projects={no_projects} invalid_chains_skipped={skipped_invalid}")


if __name__ == "__main__":
    asyncio.run(main(apply="--apply" in sys.argv))
