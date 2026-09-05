"""Cross-check the synced numbers against MySQL using the agreed definitions.

Client:   Projects = COUNT(DISTINCT p.id) WHERE p.client_id = X
          Serviced = projects (of X) with >= 1 call having revenue_in_usd > 0
          Calls    = COUNT(DISTINCT c.id) WHERE c.fk_project IN (X's projects)
          Revenue  = SUM(c.revenue_in_usd) over the same calls
          Contacts = Mongo client_contacts currently mapped (client_name == X.name)
Contact:  same, with "X's projects" = projects whose client_contacts list contains X.id
Run:  cd /app/backend && python3 scripts/verify_crm_numbers.py
"""
import os, sys, asyncio
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
import pymysql
from pymysql.cursors import DictCursor
from core import db


def sql():
    return pymysql.connect(host=os.environ["MYSQL_HOST"], user=os.environ["MYSQL_USER"],
                           password=os.environ["MYSQL_PASSWORD"], database=os.environ["MYSQL_DB"],
                           cursorclass=DictCursor, connect_timeout=15)


async def main():
    conn = sql(); cur = conn.cursor()
    # Top-3 clients by project count + 3 contacts by project count
    cur.execute("SELECT client_id id, COUNT(DISTINCT id) n FROM projects GROUP BY client_id ORDER BY n DESC LIMIT 3")
    clients = [r["id"] for r in cur.fetchall()]
    ok = True
    for clid in clients:
        cur.execute("SELECT COUNT(DISTINCT id) n FROM projects WHERE client_id=%s", [clid]); projects = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(DISTINCT c.id) n, IFNULL(SUM(c.revenue_in_usd),0) rev FROM calls c JOIN projects p ON p.id=c.fk_project WHERE p.client_id=%s", [clid]); r = cur.fetchone(); calls, rev = r["n"], int(round(float(r["rev"])))
        cur.execute("SELECT COUNT(DISTINCT p.id) n FROM projects p JOIN calls c ON c.fk_project=p.id WHERE p.client_id=%s AND c.revenue_in_usd>0", [clid]); serviced = cur.fetchone()["n"]
        cur.execute("SELECT name FROM clients WHERE id=%s", [clid]); name = cur.fetchone()["name"]
        doc = await db.clients.find_one({"mysql_ref.mysql_id": clid}, {"_id": 0, "name": 1, "totals_till_date": 1, "client_contact_count": 1})
        cc = await db.client_contacts.count_documents({"client_name": doc["name"]})
        got = doc["totals_till_date"]; exp = {"projects": projects, "serviced": serviced, "calls": calls, "revenue": rev}
        match = got == exp and doc.get("client_contact_count") == cc
        ok &= match
        print(f"CLIENT {clid} {name!r}: SQL={exp} contacts={cc} | Mongo={got} contacts={doc.get('client_contact_count')} -> {'OK' if match else 'MISMATCH'}")
    cur.execute("SELECT client_contacts cc FROM projects WHERE client_contacts REGEXP '^[0-9]+$' GROUP BY client_contacts ORDER BY COUNT(*) DESC LIMIT 3")
    for row in cur.fetchall():
        cid = int(row["cc"])
        cur.execute("SELECT id FROM projects WHERE CONCAT(',',IFNULL(client_contacts,''),',') LIKE %s", [f"%,{cid},%"]); pids = [r["id"] for r in cur.fetchall()]
        ph = ",".join(["%s"] * len(pids))
        cur.execute(f"SELECT COUNT(DISTINCT id) n, IFNULL(SUM(revenue_in_usd),0) rev FROM calls WHERE fk_project IN ({ph})", pids); r = cur.fetchone(); calls, rev = r["n"], int(round(float(r["rev"])))
        cur.execute(f"SELECT COUNT(DISTINCT fk_project) n FROM calls WHERE revenue_in_usd>0 AND fk_project IN ({ph})", pids); serviced = cur.fetchone()["n"]
        doc = await db.client_contacts.find_one({"mysql_ref.mysql_id": cid}, {"_id": 0, "name": 1, "totals_till_date": 1})
        got = doc["totals_till_date"]; exp = {"projects": len(pids), "serviced": serviced, "calls": calls, "revenue": rev}
        match = got == exp; ok &= match
        print(f"CONTACT {cid} {doc['name']!r}: SQL={exp} | Mongo={got} -> {'OK' if match else 'MISMATCH'}")
    print("ALL OK" if ok else "SOME MISMATCH")

asyncio.run(main())
