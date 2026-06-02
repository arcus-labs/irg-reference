# Reg E Adjudication Case · case-007-account-takeover

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $4,275.00 (three external ACH transfers)
**Alleged unauthorized event:** account takeover followed by external ACH transfers to unfamiliar payees
**Date range of disputed transactions:** 2026-10-22 (between 23:11 and 23:58 UTC)
**Date dispute was filed:** 2026-10-23 06:14 UTC (~7 hours after the last transfer)

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Avery W. |
| Account | Northwind consumer checking · ****5097 |
| Account opened | 2022-11-04 |
| Form submitted | 2026-10-23 06:14 UTC |
| Channel | call center (consumer locked out of mobile app) |

Consumer statement:

> "I can't log in to the app — my password isn't working. I just woke up and saw three text alerts about money being sent out of my account last night to people I do not know. The total is over $4,000. I did not authorize any of this. Please reverse it and lock my account."

---

## Account Session Log (the 48 hours before dispute filing)

| Timestamp (UTC) | Channel | IP | Geo | Action |
|---|---|---|---|---|
| 2026-10-21 19:02 | mobile | 73.142.x.x | Austin, TX, US | routine balance check (consumer) |
| 2026-10-22 13:30 | mobile | 73.142.x.x | Austin, TX, US | routine balance check (consumer) |
| 2026-10-22 22:48 | web | **154.81.x.x** | **Lagos, Nigeria** | login (correct password — first session from this geo) |
| 2026-10-22 22:51 | web | 154.81.x.x | Lagos, Nigeria | password change |
| 2026-10-22 22:53 | web | 154.81.x.x | Lagos, Nigeria | added external payee "J.O.K." |
| 2026-10-22 22:55 | web | 154.81.x.x | Lagos, Nigeria | added external payee "M.E.A." |
| 2026-10-22 23:11 | web | 154.81.x.x | Lagos, Nigeria | initiated ACH transfer $1,475.00 to "J.O.K." |
| 2026-10-22 23:33 | web | 154.81.x.x | Lagos, Nigeria | initiated ACH transfer $1,400.00 to "M.E.A." |
| 2026-10-22 23:58 | web | 154.81.x.x | Lagos, Nigeria | initiated ACH transfer $1,400.00 to "M.E.A." |
| 2026-10-23 06:14 | call center | n/a | n/a | consumer reports |

---

## Authentication & Risk Signals

- Password change at 22:51 UTC was completed via the "forgot password" flow, which sent a reset link to the email on file. The email account itself was not under Northwind's control; if compromised, the reset link would have been intercepted.
- The login at 22:48 UTC was the first ever session from a Nigerian IP on this account.
- Risk score on the 22:48 UTC login was elevated (anomalous geo + new device fingerprint) but did not exceed the threshold that triggers step-up MFA in Northwind's current configuration.
- The two new external payees were both added within minutes of the login and were used immediately, a pattern Northwind's fraud team documents as classic account-takeover behavior.

---

## Customer Account History

- 47 months on file. No prior fraud claims.
- All prior external ACH transfers have been to a small set of recurring payees (e.g., rent, savings). The two newly-added payees had no prior relationship with the account.

---

## Reporting Timeline

| Event | Timestamp |
|---|---|
| First disputed transfer | 2026-10-22 23:11 UTC |
| Last disputed transfer | 2026-10-22 23:58 UTC |
| Consumer reported (call center) | 2026-10-23 06:14 UTC |
| Account locked by fraud team | 2026-10-23 06:18 UTC |
| Periodic statement reflecting these transfers | not yet transmitted (transfers occurred mid-cycle) |

Reporting interval: **same day**, within 7 hours of the last transfer — well within two business days of learning of the unauthorized activity.

---

## Evidence Index

- [E1] Three external ACH transfers totaling $4,275.00 were initiated from the consumer's account between 23:11 and 23:58 UTC on 2026-10-22 to two payees ("J.O.K." and "M.E.A.").
- [E2] The session that initiated the transfers originated from IP 154.81.x.x geolocated to Lagos, Nigeria — the first ever session from a Nigerian IP on this account in 47 months of history.
- [E3] The session began with a "forgot password" reset flow, followed by a password change at 22:51 UTC, suggesting an out-of-band compromise of the consumer's email account.
- [E4] Both external payees were added within minutes of the login (22:53 and 22:55 UTC) and used immediately — a pattern consistent with account takeover.
- [E5] The risk score on the originating login was elevated but did not cross the threshold that would have triggered step-up MFA under Northwind's current configuration — an institutional control gap, not a consumer authorization.
- [E6] The consumer reported the unauthorized activity within 7 hours of the last transfer, well before any periodic statement reflecting it was transmitted.
- [E7] The consumer has 47 months of history with no prior fraud claims and a stable pattern of external transfers to recurring payees only.
