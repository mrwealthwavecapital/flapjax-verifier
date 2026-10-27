// flapjax-verifier — free FLAPJAX payout checker (read-only, no dependencies).
//
// Reads a BSC transaction straight from BNB Smart Chain (public JSON-RPC) and
// checks it against the FlapJax payout pattern:
//   * the transaction succeeded (status 0x1)
//   * it contains exactly one FLAPJAX Transfer log
//   * the Transfer sender is the FlapJax treasury (or the escrow)
//   * the Transfer recipient matches the wallet named in the claim
//     comment (--recipient) and the amount matches the receipt (--amount)
//
// No account, no key, no payment, no write to the chain. Everything it reads
// is public BSC data. Node 18+ (global fetch, BigInt). No dependencies.
//
// Usage:
//   node verifier.js <txHash> [--recipient <0x...>] [--amount <FLAPJAX>]
//                    [--rpc <url>] [--json]
//   node verifier.js 0xabff90086bac2f25c20d22ae3764da3dea3fddf39595a43ccd09e10cffe56d2b \
//     --recipient 0x7c7da4eC9BAB1fcEe5006F92d39d72B1c0AC93db --amount 250000
//
// Exit code: 0 = the transaction is a FlapJax payout matching the claim;
//            1 = it is not a FlapJax payout, or a check mismatched;
//            2 = usage / network error (could not read the transaction).

const FLAPJAX = '0x90c8889f428F9Ebb77BB8f15CAD3a50a9aC680df';
const TREASURY = '0x7C34E9e21eE28A49Ff0b84B61774119E6633359f';
const ESCROW = '0x9486B3304cAcA38eF42148eC8618925f15b3759e';
const TRANSFER_TOPIC0 =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DECIMALS = 18n;
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc.publicnode.com',
  'https://rpc-bsc.48.club',
  'https://1rpc.io/bnb',
];
const RPC_TIMEOUT_MS = 15000;

function isTxHash(h) {
  return typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h.trim());
}
function isAddress(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}
function addrFromTopic(topic) {
  return '0x' + String(topic).slice(26).toLowerCase();
}
function formatFlapjax(raw) {
  const n = BigInt(raw);
  const whole = n / 10n ** DECIMALS;
  const frac = n % 10n ** DECIMALS;
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
  return whole.toString() + (fracStr ? '.' + fracStr : '');
}
function parseAmount(str) {
  // Accept "250000", "250,000" or "250000.5" FLAPJAX; convert to raw units.
  const clean = String(str).replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`not a FLAPJAX amount: ${str}`);
  const [whole, frac = ''] = clean.split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** DECIMALS + BigInt(fracPadded || '0');
}

async function rpcCall(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC error');
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

async function tryBscRpcs(method, params, rpcs = BSC_RPCS) {
  const errors = [];
  for (const url of rpcs) {
    try {
      const result = await rpcCall(url, method, params);
      return { result, rpc: url };
    } catch (e) {
      errors.push(`${url}: ${e && e.message ? e.message : String(e)}`);
    }
  }
  throw new Error('All BSC RPCs failed: ' + errors.join(' | '));
}

function decodeTransfers(receipt) {
  const transfers = [];
  for (const lg of receipt.logs || []) {
    if (!lg || !Array.isArray(lg.topics) || lg.topics.length < 3) continue;
    if (String(lg.address).toLowerCase() !== FLAPJAX.toLowerCase()) continue;
    if (String(lg.topics[0]).toLowerCase() !== TRANSFER_TOPIC0) continue;
    // A standard ERC-20 Transfer carries exactly 32 bytes of data (the amount):
    // '0x' + 64 hex chars = 66 characters. Non-standard events with other
    // data lengths are skipped, not parsed.
    if (typeof lg.data !== 'string' || lg.data.length !== 66) continue;
    transfers.push({
      from: addrFromTopic(lg.topics[1]),
      to: addrFromTopic(lg.topics[2]),
      amountRaw: lg.data,
      amount: formatFlapjax(lg.data),
      logIndex: lg.logIndex,
    });
  }
  return transfers;
}

/**
 * Verify one BSC transaction against the FlapJax payout pattern.
 * opts: { recipient?: string, amount?: string|number, rpcs?: string[] }
 * Returns a result object; result.isPayout is true only when the transaction
 * is a successful FlapJax payout AND every supplied claim field matches.
 */
export async function verify(txHash, opts = {}) {
  const hash = txHash.trim().toLowerCase();
  if (!isTxHash(hash)) throw new Error('not a transaction hash (expected 0x + 64 hex chars)');
  const expectedRecipient = opts.recipient ? opts.recipient.trim().toLowerCase() : null;
  if (expectedRecipient && !isAddress(expectedRecipient)) {
    throw new Error(`--recipient is not an address: ${opts.recipient}`);
  }
  const expectedAmountRaw = opts.amount !== undefined && opts.amount !== null
    ? parseAmount(opts.amount)
    : null;

  const { result: receipt, rpc } = await tryBscRpcs(
    'eth_getTransactionReceipt', [hash], opts.rpcs
  );
  if (receipt === null) {
    // No receipt: either pending, or the hash does not exist on BSC.
    const { result: tx } = await tryBscRpcs('eth_getTransaction', [hash], opts.rpcs);
    return {
      hash,
      exists: !!tx,
      pending: !!tx,
      isPayout: false,
      checks: [],
      verdict: tx
        ? 'Transaction exists but has no receipt yet — still pending on BSC.'
        : 'No transaction with that hash exists on BSC.',
      rpc,
    };
  }

  const statusOk = receipt.status === '0x1' || receipt.status === 1;
  const blockNumber = parseInt(receipt.blockNumber, 16);
  let timestamp = null;
  try {
    const { result: block } = await tryBscRpcs(
      'eth_getBlockByNumber', [receipt.blockNumber, false], opts.rpcs
    );
    if (block && block.timestamp) timestamp = new Date(parseInt(block.timestamp, 16) * 1000).toISOString();
  } catch { /* timestamp is nice-to-have */ }

  const transfers = decodeTransfers(receipt);
  const first = transfers[0] || null;

  const checks = [];
  checks.push({ field: 'status', expected: 'success (0x1)', actual: statusOk ? 'success (0x1)' : 'FAILED / reverted', match: statusOk });
  checks.push({
    field: 'FLAPJAX Transfer logs',
    expected: 'exactly 1',
    actual: String(transfers.length),
    match: transfers.length === 1,
  });
  if (first) {
    const senderIsTreasury = first.from === TREASURY.toLowerCase();
    const senderIsEscrow = first.from === ESCROW.toLowerCase();
    checks.push({
      field: 'sender',
      expected: 'treasury or escrow',
      actual: first.from + (senderIsTreasury ? ' (treasury)' : senderIsEscrow ? ' (escrow)' : ' (other)'),
      match: senderIsTreasury || senderIsEscrow,
    });
    checks.push({ field: 'token contract', expected: FLAPJAX, actual: FLAPJAX, match: true });
    checks.push({ field: 'amount', expected: expectedAmountRaw !== null ? formatFlapjax(expectedAmountRaw.toString()) + ' FLAPJAX' : '(not checked)', actual: first.amount + ' FLAPJAX', match: expectedAmountRaw === null ? true : BigInt(first.amountRaw) === expectedAmountRaw });
    // Recipient vs the wallet in the claim comment — the check FlapJax asked for.
    checks.push({
      field: 'recipient',
      expected: expectedRecipient ? expectedRecipient : '(not checked)',
      actual: first.to,
      match: expectedRecipient === null ? true : first.to === expectedRecipient,
    });
  } else {
    checks.push({ field: 'sender', expected: 'treasury or escrow', actual: '(no FLAPJAX Transfer log)', match: false });
    checks.push({ field: 'token contract', expected: FLAPJAX, actual: '(no FLAPJAX Transfer log)', match: false });
    checks.push({ field: 'amount', expected: expectedAmountRaw !== null ? formatFlapjax(expectedAmountRaw.toString()) + ' FLAPJAX' : '(not checked)', actual: '(no FLAPJAX Transfer log)', match: false });
    checks.push({ field: 'recipient', expected: expectedRecipient ? expectedRecipient : '(not checked)', actual: '(no FLAPJAX Transfer log)', match: false });
  }

  const isPayout = checks.every((c) => c.match);
  let verdict;
  if (transfers.length === 0) {
    verdict = 'NOT a FlapJax payout: this transaction contains no FLAPJAX transfer.';
  } else if (!isPayout) {
    const failed = checks.filter((c) => !c.match).map((c) => c.field).join(', ');
    verdict = `Moves FLAPJAX but does not match the payout pattern (mismatch: ${failed}).`;
  } else if (first.from === ESCROW.toLowerCase()) {
    verdict = 'FlapJax payout (sender is the escrow) — all checked fields match.';
  } else {
    verdict = 'FlapJax payout (sender is the treasury) — all checked fields match.';
  }

  return {
    hash,
    exists: true,
    pending: false,
    blockNumber,
    timestamp,
    statusOk,
    transfers,
    checks,
    isPayout,
    verdict,
    rpc,
  };
}

function printUsage() {
  console.log(`Usage: node verifier.js <txHash> [--recipient <0x...>] [--amount <FLAPJAX>] [--rpc <url>] [--json]

  <txHash>     BSC transaction hash (0x + 64 hex chars)
  --recipient  wallet from the claimant's claim comment; the on-chain
               recipient must match it exactly
  --amount     FLAPJAX amount stated in the receipt (e.g. 250000)
  --rpc        use this BSC RPC instead of the built-in list (repeatable)
  --json       print the result as JSON instead of a human-readable table

Exit code: 0 = FlapJax payout matching the claim; 1 = not a payout or a
mismatch; 2 = usage or network error.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opts = { recipient: null, amount: null, rpcs: [], json: false };
  let txHash = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--recipient') opts.recipient = args[++i];
    else if (a === '--amount') opts.amount = args[++i];
    else if (a === '--rpc') opts.rpcs.push(args[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (!a.startsWith('-') && !txHash) txHash = a;
    else { console.error(`Unknown argument: ${a}`); printUsage(); process.exit(2); }
  }
  if (!txHash) { console.error('Missing transaction hash.'); printUsage(); process.exit(2); }
  if (opts.rpcs.length) opts.rpcs = opts.rpcs; else delete opts.rpcs;

  try {
    const r = await verify(txHash, opts);
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`Transaction: ${r.hash}`);
      console.log(`BscScan:     https://bscscan.com/tx/${r.hash}`);
      if (r.exists && !r.pending) {
        console.log(`Block:       ${r.blockNumber}${r.timestamp ? ` (${r.timestamp})` : ''}`);
      }
      console.log(`Checked via: ${r.rpc}`);
      console.log('');
      for (const c of r.checks) {
        console.log(`  ${c.match ? 'MATCH   ' : 'MISMATCH'}  ${c.field}: ${c.actual}${c.expected !== '(not checked)' ? `  (expected: ${c.expected})` : ''}`);
      }
      console.log('');
      console.log(r.isPayout ? `✓ ${r.verdict}` : `✗ ${r.verdict}`);
    }
    process.exit(r.isPayout ? 0 : 1);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }
}
