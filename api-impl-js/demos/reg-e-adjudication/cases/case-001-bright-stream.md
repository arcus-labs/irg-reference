# Reg E Adjudication Case · case-001-bright-stream

**Status:** intake → assigned to IRG adjudication
**Disputed amount:** $487.23
**Alleged unauthorized merchant:** BrightStream Media (BSM-EU-114)
**Date of disputed transaction:** 2026-08-15
**Date dispute was filed:** 2026-08-17

---

## Consumer Dispute Form

| Field | Value |
|---|---|
| Consumer | Jordan M. |
| Account | Northwind consumer checking · ****1247 |
| Account opened | 2024-11-03 |
| Form submitted | 2026-08-17 08:14 UTC (in-app dispute form) |
| Channel | mobile app · authenticated session |

Consumer statement (verbatim):

> "I never signed up for BrightStream Media. I just noticed a $487.23 charge to them on my account when I looked at my statement this morning. I have no idea who they are and I never agreed to this. I want my money back. I'm worried someone got my card info."

---

## Transaction Record (internal ledger)

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-08-15 23:43:11 |
| Merchant | BrightStream Media (merchant_id: BSM-EU-114) |
| Merchant category | streaming media / digital subscription (MCC 4899) |
| Amount | $487.23 |
| Channel | card-not-present |
| Auth method | recurring billing token `tok_9af2e1c4` |
| Network response | approved · no 3DS step-up requested by merchant |
| Posting | posted to account 2026-08-16 04:00 UTC |

---

## Authorization & Tokenization Record

| Field | Value |
|---|---|
| Token | `tok_9af2e1c4` |
| Provisioned (UTC) | 2026-02-09 14:08 |
| Origin | consumer-initiated subscription enrollment at brightstreammedia.com |
| Consent artifact | `BSM-CONSENT-2026-02-09-9af2e1c4` (merchant-side consent receipt; mirrored to network tokenization vault) |
| Recurring schedule (merchant-side) | 6-month free trial → quarterly billing thereafter |
| First scheduled billing event | 2026-08-15 |
| Prior charges on this token | none (this is the first billing event after the trial) |
| Consumer-side cancellation requests against this token | none on file |

---

## Account Session Log (mobile + web)

| Timestamp (UTC) | Channel | Notes |
|---|---|---|
| 2026-08-13 19:02 | mobile | routine balance check |
| 2026-08-15 11:20 | mobile | routine balance check |
| **2026-08-15 23:43** | (none) | disputed transaction — **no consumer-authenticated session active** |
| 2026-08-16 04:00 | system | periodic statement transmitted |
| 2026-08-17 08:14 | mobile | dispute filed |

---

## Customer Account History (24 months)

- Account age: 21 months. No prior fraud claim filed on this account.
- No prior transactions to BrightStream Media or to any merchant in the streaming-media MCC.
- Six prior recurring-subscription enrollments on file (e.g., Spotify, NYT, Hulu, Patreon), each backed by a consumer-initiated consent token similar in shape to `tok_9af2e1c4`. None has been disputed.
- Login behavior pattern: weekday evening + weekend mornings (UTC). No anomalous geolocation in the last 90 days.

---

## Merchant Profile (BrightStream Media · BSM-EU-114)

- Legitimate registered streaming service (EU-incorporated). On Northwind's known-merchant list since 2023.
- Standard billing model: 6-month free trial → quarterly recurring at $487.23.
- Free-trial enrollment requires (a) email verification and (b) a tokenized card on file.
- Not on any current Northwind fraud-watch list.

---

## Reporting Timeline

| Event | Timestamp (UTC) |
|---|---|
| Disputed transaction occurred | 2026-08-15 23:43 |
| Periodic statement transmitted | 2026-08-16 04:00 |
| Consumer reported (dispute filed) | 2026-08-17 08:14 |
| Business days between statement and report | < 2 |

---

## Evidence Index (citation handles)

Each item below is a fact-of-record from Northwind's systems or the consumer's submission. The adjudicator may cite them inline as `[E1]`, `[E2]`, etc.

- [E1] A transaction of $487.23 to BrightStream Media was processed on 2026-08-15 at 23:43 UTC, card-not-present, authorized via recurring billing token `tok_9af2e1c4`.
- [E2] Token `tok_9af2e1c4` was provisioned on 2026-02-09 from a consumer-initiated subscription enrollment that produced consent artifact `BSM-CONSENT-2026-02-09-9af2e1c4`.
- [E3] BrightStream Media's standard billing model is a 6-month free trial followed by quarterly recurring billing at $487.23 per cycle, and the disputed transaction is the first billing event after that trial.
- [E4] No consumer-authenticated mobile or web session was active at the time of the disputed transaction.
- [E5] The consumer has no prior transactions with BrightStream Media or any other streaming-media merchant on this account.
- [E6] The consumer states that they never signed up for BrightStream Media and did not authorize the transaction.
- [E7] The consumer reported the disputed transaction within two business days of the periodic statement on which it first appeared (statement 2026-08-16, report 2026-08-17).
- [E8] The merchant is a known, registered streaming service in good standing on Northwind's merchant directory.
- [E9] The token was used for the first time in this billing event; no prior charges have been made against this token, and no consumer-side cancellation request for this token is on file.
