# Auth Testing Playbook (Emergent Auth)

Emergent Auth flow:
1. Frontend redirects to `https://auth.emergentagent.com/?redirect={app_url}/auth/callback`
2. After Google sign-in, user lands at `{app_url}/auth/callback#session_id=XXX`
3. `AuthCallback.jsx` parses the session_id and POSTs it to `/api/auth/google-session`
4. Backend calls `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` with `X-Session-ID` header
5. Backend looks up email in `contacts` collection — only Active contacts are allowed
6. On success: backend issues a JWT `access_token` cookie + token in response body and `AuthCallback` routes the user to their role-based dashboard

Test cases:
- POST `/api/auth/google-session` with invalid session_id → 401
- POST `/api/auth/google-session` where email is not in contacts → 403 ("not registered")
- POST `/api/auth/google-session` where contact is Inactive → 403 ("inactive")
- Successful flow: 200 with `{user, access_token}` and cookie set

Manual end-to-end test:
1. Click "Continue with Google" on /login
2. Sign in with a Google account whose email == an Active contact (e.g. admin@ticketing.com)
3. You should land on /admin (or /ra or /dq based on role)
4. Cookie `access_token` should be set; `/api/auth/me` should return the user
