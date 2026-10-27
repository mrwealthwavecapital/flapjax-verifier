// Tests for flapjax-verifier. Live tests: they read real BSC transactions
// from public RPCs, so they need network access. Run with: npm test
// (or: node --test test.js)
//
// The two cases FlapJax asked for:
//   1. a KNOWN payout tx — Q60 (FlapJax paid 250,000 FLAPJAX, Oct 25 2026)
//   2. a NON-payout tx — an ordinary native-BNB transfer with no FLAPJAX log
// Plus: a recipient-mismatch case (the check FlapJax asked for) and a second
// known payout (B474, from the same Q60 audit) as a regression case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from './verifier.js';

// Q60 payout: FlapJax treasury -> agent wallet, 250,000 FLAPJAX,
// block 129,752,829, tx 0xabff90086bac2f25c20d22ae3764da3dea3fddf39595a43ccd09e10cffe56d2b.
// Confirmed on-chain twice (48.club + bsc-dataseed) and in writing by FlapJax.
const Q60_TX = '0xabff90086bac2f25c20d22ae3764da3dea3fddf39595a43ccd09e10cffe56d2b';
const Q60_RECIPIENT = '0x7c7da4eC9BAB1fcEe5006F92d39d72B1c0AC93db'; // wallet in the Q60 claim comment
const TREASURY = '0x7C34E9e21eE28A49Ff0b84B61774119E6633359f';

// B474 payout: treasury -> 0x5b4Ca59741DE12DC212982b342392a063492a021, 300,000 FLAPJAX,
// block 129,720,657. From the same Q60 audit (receipt 1 of 3, 12/12 fields matched).
const B474_TX = '0x85d2c59232c1c333a45a7bf829680bb8a8f5c62b84b849a4330cb2c408436253';
const B474_RECIPIENT = '0x5b4Ca59741DE12DC212982b342392a063492a021';

// Non-payout: a plain native-BNB transfer (0.003013345 BNB), block 79,464,840.
// It carries no token logs at all, so it cannot be a FLAPJAX payout.
const NON_PAYOUT_TX = '0x3e5194c19461d50f30f68b61e9979980597e122f331066cef841e6583fb93ad6';

test('known payout tx: Q60 is a FlapJax payout matching the claim', async () => {
  const r = await verify(Q60_TX, { recipient: Q60_RECIPIENT, amount: 250000 });
  assert.equal(r.isPayout, true, r.verdict);
  assert.equal(r.blockNumber, 129752829);
  assert.equal(r.statusOk, true);
  assert.equal(r.transfers.length, 1);
  assert.equal(r.transfers[0].from, TREASURY.toLowerCase());
  assert.equal(r.transfers[0].to, Q60_RECIPIENT.toLowerCase());
  assert.equal(r.transfers[0].amount, '250000');
  for (const c of r.checks) assert.equal(c.match, true, `${c.field} should match`);
});

test('known payout tx: B474 is a FlapJax payout matching the claim', async () => {
  const r = await verify(B474_TX, { recipient: B474_RECIPIENT, amount: 300000 });
  assert.equal(r.isPayout, true, r.verdict);
  assert.equal(r.blockNumber, 129720657);
  assert.equal(r.transfers.length, 1);
  assert.equal(r.transfers[0].from, TREASURY.toLowerCase());
  assert.equal(r.transfers[0].to, B474_RECIPIENT.toLowerCase());
  assert.equal(r.transfers[0].amount, '300000');
});

test('non-payout tx: ordinary BNB transfer is not a FlapJax payout', async () => {
  const r = await verify(NON_PAYOUT_TX);
  assert.equal(r.isPayout, false);
  assert.equal(r.exists, true);
  assert.equal(r.transfers.length, 0);
  assert.match(r.verdict, /not a FlapJax payout/i);
});

test('recipient check: Q60 payout with the wrong recipient does not match', async () => {
  const r = await verify(Q60_TX, { recipient: B474_RECIPIENT, amount: 250000 });
  assert.equal(r.isPayout, false);
  const recipientCheck = r.checks.find((c) => c.field === 'recipient');
  assert.equal(recipientCheck.match, false);
  assert.equal(recipientCheck.actual, Q60_RECIPIENT.toLowerCase());
  // Every other check still passes — only the recipient mismatches.
  for (const c of r.checks) {
    if (c.field !== 'recipient') assert.equal(c.match, true, `${c.field} should match`);
  }
});

test('amount check: Q60 payout with the wrong amount does not match', async () => {
  const r = await verify(Q60_TX, { recipient: Q60_RECIPIENT, amount: 300000 });
  assert.equal(r.isPayout, false);
  const amountCheck = r.checks.find((c) => c.field === 'amount');
  assert.equal(amountCheck.match, false);
});

test('invalid input: a bad hash throws instead of returning a verdict', async () => {
  await assert.rejects(() => verify('not-a-hash'), /not a transaction hash/);
});
