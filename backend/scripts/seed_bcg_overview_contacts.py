"""Seed dummy client contacts for Boston Consulting Group and map each to a
Level-2 segment (5-20 contacts per segment). Idempotent — re-running first
removes previously seeded demo rows (tagged seed_tag='crm_overview_bcg_demo').

Run:  python -m scripts.seed_bcg_overview_contacts   (from /app/backend)
"""
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
COLL = "client_contacts"
SEED_TAG = "crm_overview_bcg_demo"
CLIENT_NAME = "Boston Consulting Group"

FIRST = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan",
         "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Anika", "Navya", "Riya", "Myra", "Kiara",
         "Kabir", "Aryan", "Dhruv", "Kunal", "Neha", "Priya", "Sneha", "Isha", "Tara", "Meera",
         "Rahul", "Nikhil", "Karan", "Varun", "Pooja", "Divya", "Shreya", "Ritika", "Nisha", "Gaurav"]
LAST = ["Sharma", "Verma", "Gupta", "Mehta", "Nair", "Iyer", "Rao", "Reddy", "Kapoor", "Malhotra",
        "Bose", "Chopra", "Sethi", "Bhat", "Kulkarni", "Menon", "Pillai", "Desai", "Joshi", "Agarwal"]

DESIGNATIONS = [
    "Partner", "Principal", "Managing Director", "Project Leader", "Consultant",
    "Senior Consultant", "Associate", "Engagement Manager", "Practice Lead",
    "Vice President", "Director", "Senior Advisor", "Knowledge Expert",
]
LOCATIONS = ["Mumbai", "New Delhi", "Bengaluru", "Gurugram", "Chennai", "Hyderabad", "Pune", "Kolkata"]

BCG_SEGMENTS = [
    "Automotive Industry", "Consumer Products Industry", "Education", "Energy",
    "Financial Institutions", "Healthcare Industry", "Industrial Goods",
    "Insurance Industry", "Principal Investors and Private Equity", "Retail Industry",
    "Public Sector", "Technology, Media & Telecommunications", "Transportation & Logistics",
    "Travel and Tourism", "Urban Planning",
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def main():
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=15000)
    db = client[DB_NAME]

    removed = db[COLL].delete_many({"seed_tag": SEED_TAG}).deleted_count
    print(f"Removed {removed} previously-seeded demo contacts")

    # continue the display_id counter so demo rows look native
    counter = db["counters"].find_one({"_id": "client_contact_display_id"})
    base = int((counter or {}).get("seq_base") or 1041)
    seq = int((counter or {}).get("seq") or 0)

    docs = []
    used_emails = set()
    for seg in BCG_SEGMENTS:
        n = random.randint(5, 20)
        for _ in range(n):
            fn, ln = random.choice(FIRST), random.choice(LAST)
            name = f"{fn} {ln}"
            email = f"{fn.lower()}.{ln.lower()}{random.randint(1, 999)}@bcg-demo.com"
            while email in used_emails:
                email = f"{fn.lower()}.{ln.lower()}{random.randint(1, 9999)}@bcg-demo.com"
            used_emails.add(email)
            seq += 1
            docs.append({
                "id": str(uuid.uuid4()),
                "display_id": base + seq,
                "name": name,
                "email": email,
                "phone": f"98{random.randint(10000000, 99999999)}",
                "phone_isd": "+91",
                "client_name": CLIENT_NAME,
                "designation": random.choice(DESIGNATIONS),
                "base_location": random.choice(LOCATIONS),
                "industries": [seg],
                "seed_tag": SEED_TAG,
                "created_by": {"id": "seed", "name": "Seed Script", "email": "seed@system"},
                "created_on": now_iso(),
                "updated_by": {"id": "seed", "name": "Seed Script", "email": "seed@system"},
                "updated_on": now_iso(),
            })

    if docs:
        db[COLL].insert_many(docs)
        db["counters"].update_one(
            {"_id": "client_contact_display_id"},
            {"$set": {"seq": seq}, "$setOnInsert": {"seq_base": base}},
            upsert=True,
        )

    # summary
    print(f"Inserted {len(docs)} demo contacts for {CLIENT_NAME}")
    for seg in BCG_SEGMENTS:
        c = db[COLL].count_documents({"client_name": CLIENT_NAME, "industries": seg, "seed_tag": SEED_TAG})
        print(f"  {seg:45s} -> {c}")


if __name__ == "__main__":
    main()
