#!/usr/bin/env python3
"""Quick verification of reopen count behavior"""
import requests

BASE_URL = "https://crm-contact-carousel.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Login
resp = requests.post(f"{BASE_URL}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
token = resp.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Create ticket
resp = requests.post(f"{BASE_URL}/tickets", json={"description": "Count test", "priority": "Medium", "number_of_profiles": 5}, headers=headers)
ticket = resp.json()
ticket_id = ticket["id"]
print(f"Created ticket: {ticket['ticket_id']}")

# Close it
resp = requests.patch(f"{BASE_URL}/tickets/{ticket_id}", json={"status": "Closed"}, headers=headers)
print(f"Closed ticket")

# Reopen 1st time
resp = requests.post(f"{BASE_URL}/tickets/{ticket_id}/reopen", json={"reason": "First reopen"}, headers=headers)
data = resp.json()
print(f"1st reopen: reopen_count = {data.get('reopen_count')}")

# Close again
resp = requests.patch(f"{BASE_URL}/tickets/{ticket_id}", json={"status": "Closed"}, headers=headers)
print(f"Closed again")

# Reopen 2nd time
resp = requests.post(f"{BASE_URL}/tickets/{ticket_id}/reopen", json={"reason": "Second reopen"}, headers=headers)
data = resp.json()
print(f"2nd reopen: reopen_count = {data.get('reopen_count')}")

# Close again
resp = requests.patch(f"{BASE_URL}/tickets/{ticket_id}", json={"status": "Closed"}, headers=headers)
print(f"Closed again")

# Reopen 3rd time
resp = requests.post(f"{BASE_URL}/tickets/{ticket_id}/reopen", json={"reason": "Third reopen"}, headers=headers)
data = resp.json()
print(f"3rd reopen: reopen_count = {data.get('reopen_count')}")
