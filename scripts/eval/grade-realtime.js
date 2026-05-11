/**
 * scripts/eval/grade-realtime.js — Scoring Engine Validator
 * Verifies that grades transition correctly and S2 uses BM25 fallback.
 */

const { gradeNode } = require('../../agents/sentinel');
const assert = require('assert');

async function testScoring() {
  console.log('[TEST] Starting Real-time Grade Evaluation...');

  const prompt = "Implement a secure login flow with JWT and payment integration via Stripe.";

  // Test 1: High relevance code
  const goodCode = `
    // Secure Login Flow
    async function login(user, pass) {
      const token = jwt.sign({ id: user.id }, SECRET);
      return { token };
    }
    // Stripe integration
    const stripe = require('stripe')(KEY);
  `;
  const res1 = await gradeNode('payment/checkout.js', goodCode, prompt, { relevance: 0.9 });
  console.log('Test 1 (Good):', res1.grade, res1.S_final.toFixed(2));
  assert(res1.grade === 'green', 'Should be green');
  assert(res1.S2 > 0.5, 'S2 should be high via BM25 + PageIndex');

  // Test 2: Irrelevant code (Drift)
  const driftCode = `
    function calculateFibonacci(n) {
      return n <= 1 ? n : fib(n-1) + fib(n-2);
    }
  `;
  const res2 = await gradeNode('utils/math.js', driftCode, prompt, null);
  console.log('Test 2 (Drift):', res2.grade, res2.S_final.toFixed(2));
  assert(res2.grade === 'red' || res2.grade === 'yellow', 'Should be low grade');
  assert(res2.S2 < 0.2, 'S2 should be low for irrelevant code');

  // Test 3: Off-scope Penalty
  const offScopeCode = `
    const paypal = require('paypal-rest-sdk'); // Not in prompt
    function pay() {}
  `;
  const res3 = await gradeNode('auth/login.js', offScopeCode, prompt, null);
  console.log('Test 3 (Penalty):', res3.D.toFixed(2));
  assert(res3.D >= 0.3, 'Should have off-scope penalty for PayPal in login.js');

  console.log('[TEST] ✅ All scoring assertions passed!');
}

testScoring().catch(e => {
  console.error('[TEST] ❌ Failed:', e.message);
  process.exit(1);
});
