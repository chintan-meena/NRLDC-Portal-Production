/**
 * Unit test for the pending-transfer conflict message (routes/users.js).
 *
 * The message must distinguish a plain duplicate (same target) from a competing
 * claim by a different QCA — the latter is the bug that let two QCAs both queue
 * a claim on one plant.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pendingTransferConflict } = require('../../routes/users');

test('a same-target resubmission reads as a duplicate', () => {
  const msg = pendingTransferConflict({ to_username: 'alpha@nrldc' }, 'alpha@nrldc', 'AAPL_BKN2');
  assert.match(msg, /already awaiting RLDC Admin approval/);
  assert.doesNotMatch(msg, /to alpha@nrldc\)/); // no "(to ...)" competing clause
});

test('a competing claim by a different QCA names the pending holder', () => {
  const msg = pendingTransferConflict({ to_username: 'beta@nrldc' }, 'alpha@nrldc', 'AAPL_BKN2');
  assert.match(msg, /already has a transfer request/);
  assert.match(msg, /to beta@nrldc/);
  assert.match(msg, /approved or rejected before another/);
});

test('the target comparison is case-insensitive', () => {
  const msg = pendingTransferConflict({ to_username: 'Alpha@NRLDC' }, 'alpha@nrldc', 'X');
  assert.match(msg, /already awaiting RLDC Admin approval/); // treated as same target
});
