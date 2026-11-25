# Financial engine

## Money
- Amounts are integers in minor units: PLN, EUR and USD have 2 decimals; RWF has 0. The API sends money as `{"amount": "12.34", "minor": 1234, "currency": "PLN"}` and never as a float.
- Input parsing is strict and ASCII-only. `12,345` is ambiguous for a 2-decimal currency and is rejected. `1e3`, `1_000`, `+5`, `12.` and too many decimals (for example RWF `10.50`) are rejected, not rounded.
- Official NBP (and ECB/BNR fallback) rates are stored and used as published; they are never rounded before converting. Reports and displayed totals sum exact converted amounts, then round half-up once to the reporting currency's minor unit. `convert()` for a single stored amount still uses banker's rounding (ROUND_HALF_EVEN). Splits use largest-remainder allocation, so parts always add up to the total.
- Refunds and reversals reduce their original category on a cash basis: they count on the refund or reversal date, not the original transaction date.
- Adding two currencies raises an error. Totals in a reporting currency convert each line first. A line without a usable rate is excluded and listed, never estimated.

## Ledger
- Every transaction posts a journal entry whose lines balance **per currency**. Cross-currency transfers go through an FX clearing account, so each currency balances on its own.
- Opening balances post against opening equity.
- Posted history is never edited or deleted. A reversal posts the mirror entry, can happen only once (unique constraint), and is idempotent.
- The ledger refuses accounts from another workspace and lines whose currency does not match the account.

## Exchange rates
| Provider | Pairs | Max age | Priority |
|---|---|---|---|
| Manual (this workspace only) | any | 31 days | 0 (wins) |
| NBP table A | EUR, USD → PLN | 7 days | 1 |
| NBP table B | RWF → PLN | 14 days | 1 |
| ECB (via frankfurter.dev) | EUR → USD, PLN | 7 days | 2 |
| BNR (via frankfurter.dev) | RWF → USD, EUR, PLN | 7 days | 3 |

The newest rate on or before the date wins, then priority. Inverse and cross rates via PLN are derived. A rate older than its maximum age counts as missing and raises a "stale rate" signal. Rates refresh every 6 hours while the API runs (`RATES_AUTO_SYNC`), or on demand with `scripts/sync-rates.sh`.

## Budgets and the AI spend guard
- Available = allocated − actual − active reservations, per calendar month (Europe/Warsaw).
- A reservation locks the budget row (`SELECT … FOR UPDATE`), converts the estimate (it fails closed if no current rate exists), checks the hard limit and stores the hold, all in one transaction. A repeat with the same `external_ref` / `run_id` returns the same reservation.
- Settling replaces the estimate with the actual cost as an AI usage record. Releasing frees the hold.

## Subscriptions
- Totals are summed from exact annual amounts (e.g. 100 zł × 1 a year, 20 zł × 12) and rounded once, then ÷ 12 for the monthly figure, so there is no 8.33 × 12 drift. ARR is the exact annual sum, not MRR × 12. A single plan's monthly equivalent is rounded once (weekly uses 52/12).
- Renewals keep month-end anchoring (31 Jan → 28/29 Feb → 31 Mar).
- A payment names the renewal it pays, so the same renewal cannot be recorded twice.

## Polish and Rwandan specifics
- IKE and IKZE 2026 limits (28,260 zł and 11,304 zł, or 16,956 zł for the self-employed) come from gov.pl. Progress counts the contributions you recorded.
- Account kinds include PPK, IKE, IKZE, MTN MoMo / Airtel Money, ikimina and Ejo Heza. Ikimina is a share-of-group account; member rotation is not modelled yet.
