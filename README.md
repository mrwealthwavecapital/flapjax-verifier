# flapjax-verifier

**Free FLAPJAX payout checker.** Paste a BSC transaction hash and check it
against the chain — no account, no key, no payment, nothing written to the
chain. It reads public BNB Smart Chain data only and tells you whether the
transaction is a FlapJax payout, and whether it matches the claim made for it.

Built from real paid FlapJax audit work (Q60, Q41, Q43, Q48 — see
[Background](#background)). Submitted for FlapJax's rung-4 tool review
(Grant #1, Oct 27 2026).

## What it verifies

For a given BSC transaction hash, the verifier checks four things against the
chain (`eth_getTransactionReceipt` from a public BSC RPC):

| Field | Expected (a FlapJax payout) |
|---|---|
| **Status** | success (`0x1`) |
| **Token** | the Transfer log comes from the FLAPJAX contract `0x90c8889f428F9Ebb77BB8f15CAD3a50a9aC680df` (18 decimals) |
| **Sender** | the Transfer sender is the FlapJax treasury `0x7C34E9e21eE28A49Ff0b84B61774119E6633359f` or the escrow `0x9486B3304cAcA38eF42148eC8618925f15b3759e` |
| **Log count** | exactly one FLAPJAX Transfer log (a payout has exactly one) |

And, when you supply them, two claim fields:

| Claim field | Check |
|---|---|
| **Recipient** (`--recipient`) | the on-chain recipient must match the wallet named in the claimant's claim comment — exactly. This is the check FlapJax asked for. |
| **Amount** (`--amount`) | the on-chain FLAPJAX amount must match the amount stated in the receipt. |

A transaction is a **payout** only when the status, log count, token and
sender all match. It **matches the claim** only when the recipient and amount
also match. A transaction with no FLAPJAX Transfer log at all is not a
FLAPJAX payment, whatever a comment says about it.

## Install and run

Requires Node 18+ (global `fetch`, `BigInt`). No dependencies to install.

```bash
git clone https://github.com/MrWealthWaveCapital/flapjax-verifier.git
cd flapjax-verifier
node verifier.js <txHash> [--recipient <0x...>] [--amount <FLAPJAX>] [--rpc <url>] [--json]
```

Examples:

```bash
# Check the Q60 payout (250,000 FLAPJAX, Oct 25 2026) against its claim
node verifier.js 0xabff90086bac2f25c20d22ae3764da3dea3fddf39595a43ccd09e10cffe56d2b \
  --recipient 0x7c7da4eC9BAB1fcEe5006F92d39d72B1c0AC93db --amount 250000
# -> ✓ FlapJax payout (sender is the treasury) — all checked fields match.

# A non-payout: an ordinary native-BNB transfer
node verifier.js 0x3e5194c19461d50f30f68b61e9979980597e122f331066cef841e6583fb93ad6
# -> ✗ NOT a FlapJax payout: this transaction contains no FLAPJAX transfer.

# JSON output (for scripts)
node verifier.js <txHash> --json
```

Exit codes: `0` = FlapJax payout matching the claim; `1` = not a payout, or
a check mismatched; `2` = usage error or the transaction could not be read
(all RPCs failed).

The verifier tries several public BSC RPCs in order
(`bsc-dataseed.binance.org`, `bsc-dataseed1.defibit.io`, `bsc.publicnode.com`,
`rpc-bsc.48.club`, `1rpc.io/bnb`) and uses the first that answers. Pass
`--rpc <url>` to use a different one.

## Tests

```bash
npm test
```

The test suite reads real BSC transactions from public RPCs and asserts:

1. **Known payout tx** — Q60:
   `0xabff90086bac2f25c20d22ae3764da3dea3fddf39595a43ccd09e10cffe56d2b`
   (250,000 FLAPJAX, treasury → `0x7c7da4eC…93db`, block 129,752,829) is a
   FlapJax payout matching its claim, with every check passing.
2. **Known payout tx (second)** — B474:
   `0x85d2c59232c1c333a45a7bf829680bb8a8f5c62b84b849a4330cb2c408436253`
   (300,000 FLAPJAX, treasury → `0x5b4Ca597…a021`, block 129,720,657) is a
   FlapJax payout matching its claim.
3. **Non-payout tx** — an ordinary native-BNB transfer:
   `0x3e5194c19461d50f30f68b61e9979980597e122f331066cef841e6583fb93ad6`
   (0.003013345 BNB, block 79,464,840) contains no FLAPJAX Transfer log and
   is correctly reported as not a FlapJax payout.
4. **Recipient mismatch** — the Q60 payout checked against a different
   wallet does *not* match (only the recipient check fails).
5. **Amount mismatch** — the Q60 payout checked against 300,000 FLAPJAX
   does *not* match.
6. **Invalid input** — a bad hash throws instead of returning a verdict.

## Free check vs. paid written report

The free transaction check in this repo is the whole tool — it is free,
unlimited, and has no payment gate of any kind.

The **paid written report** is a separate product, not in this repo: a
formatted markdown verification report (the same format as the public
FlapJax payout audits) that lives on the builder's site and is unlocked by a
$0.01 USDC payment on Base. The free checker and the paid report are kept
separate — the checker never asks for payment, and the report is never
required to use the checker.

## Limits (stated plainly)

- This tool reads the **chain**, not the receipt comment. FlapJax receipt
  comments name a recipient handle, not a wallet — the wallet usually comes
  from that claimant's own claim comment, so compare the recipient address
  against the wallet the claimant gave (that is what `--recipient` is for).
- A report that finds a mismatch is worth the same as one that finds none:
  a mismatch is a finding, not a failure.
- FLAPJAX is a small meme token with thin liquidity; verifying a payment
  says nothing about its dollar value.
- RPCs are public and can be slow or rate-limited; the tool retries across
  five endpoints before giving up.

## Background

The verifier's logic comes from four public FlapJax payout audits (Oct 2026),
all done by reading receipts and logs directly from public BSC RPCs — never
from FlapJax's own API or ledger:

- **Q60** (Oct 25): 3 payout receipts checked, 12 of 12 fields matched
  (B474, B475, B476 — 300,000 FLAPJAX each). The audit itself was accepted
  and paid 250,000 FLAPJAX (tx above), taking the reserved first-timer slot
  B498.
- **Q43** (Oct 16–17): 301-transfer reconciliation of the treasury's
  outflows; found a real inconsistency (the Oct 16 buyback the summary said
  did not happen).
- **Q48** (Oct 26): 33 transfers, 8,200,000 FLAPJAX, 26 unique recipients,
  grouped by first BNB funder; paid 300,000 FLAPJAX (250,000 × 1.2 hold-test
  bonus).
- **Q74** (Oct 26): 27 transfers, 18,190,000 FLAPJAX, 17 recipients.

Reference data baked into the verifier: total supply 44,444,444,444 FLAPJAX;
the top 20 holders own 78.47% of supply (two PancakeSwap V3 pools hold
57.75% combined — extremely concentrated); the 14-day buyback was 12 buys of
exactly 0.01 BNB.

## License

MIT — see [LICENSE](LICENSE).
