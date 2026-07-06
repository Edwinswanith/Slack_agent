#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { extractEvidence } from '../src/llm/gemini';
import { detectPiiRegex } from '../src/core/piiDetection';

// Load .env file
dotenv.config({ path: '.env' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../evals/fixtures');

/**
 * Load fixture JSON files
 */
function loadFixture(filename: string) {
  const filepath = path.join(fixturesDir, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Run assertions for A1 fixture (Kolathur transport - expect 1 finance item)
 */
async function testA1() {
  console.log('\n=== A1: Kolathur Transport Message ===');
  const fixture = loadFixture('a1-kolathur-transport.json');

  const sourceMaterials = [
    {
      sourceRef: fixture.source_ref,
      text: fixture.source_text
    }
  ];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);

    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;

    // Check item count
    if (items.length !== assertion.item_count) {
      return {
        pass: false,
        reason: `Expected ${assertion.item_count} item(s), got ${items.length}`,
        items
      };
    }

    if (items.length === 0) {
      return { pass: true };
    }

    const item = items[0];

    // Check requirement key
    if (item.requirement_key !== assertion.requirement_key) {
      return {
        pass: false,
        reason: `Expected requirement_key "${assertion.requirement_key}", got "${item.requirement_key}"`,
        item
      };
    }

    // Check quote_text is exact
    if (item.quote_text !== assertion.quote_text_must_match) {
      return {
        pass: false,
        reason: `Quote text does not match exactly.\nExpected: "${assertion.quote_text_must_match}"\nGot: "${item.quote_text}"`,
        item
      };
    }

    // Check confidence
    if (item.confidence < assertion.confidence_min) {
      return {
        pass: false,
        reason: `Confidence ${item.confidence} is below minimum ${assertion.confidence_min}`,
        item
      };
    }

    // Check unit_ambiguous
    if (item.unit_ambiguous !== assertion.unit_ambiguous) {
      return {
        pass: false,
        reason: `unit_ambiguous should be ${assertion.unit_ambiguous}, got ${item.unit_ambiguous}`,
        item
      };
    }

    // Check pii_detected
    if (item.pii_detected !== assertion.pii_detected) {
      return {
        pass: false,
        reason: `pii_detected should be ${assertion.pii_detected}, got ${item.pii_detected}`,
        item
      };
    }

    return { pass: true, item };
  } catch (e) {
    const error = e as any;
    return {
      pass: false,
      reason: `Extraction failed: ${error.message}`,
      error: e
    };
  }
}

/**
 * Run assertions for A2 fixture (Speculative - expect 0 items)
 */
async function testA2() {
  console.log('\n=== A2: Speculative Future-Tense Statement ===');
  const fixture = loadFixture('a2-speculative.json');

  const sourceMaterials = [
    {
      sourceRef: fixture.source_ref,
      text: fixture.source_text
    }
  ];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);

    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;

    // Check item count (should be 0)
    if (items.length !== assertion.item_count) {
      return {
        pass: false,
        reason: `Expected ${assertion.item_count} items (speculative statement should extract nothing), got ${items.length}`,
        items
      };
    }

    return { pass: true };
  } catch (e) {
    const error = e as any;
    return {
      pass: false,
      reason: `Extraction failed: ${error.message}`,
      error: e
    };
  }
}

/**
 * Run assertions for A3 fixture (future-tense expected count, out-of-period - expect 0 items)
 */
async function testA3() {
  console.log('\n=== A3: Out-of-Period Speculative Count ===');
  const fixture = loadFixture('a3-out-of-period-speculative.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;
    if (items.length !== assertion.item_count) {
      return {
        pass: false,
        reason: `Expected ${assertion.item_count} items, got ${items.length}`,
        items,
      };
    }

    return { pass: true };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Run assertions for A4 fixture (implausible, joking-tone number - expect 0 items, or 1 low-confidence item)
 */
async function testA4() {
  console.log('\n=== A4: Implausible Joking-Tone Number ===');
  const fixture = loadFixture('a4-implausible-joking.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;
    if (items.length > assertion.item_count_max) {
      return {
        pass: false,
        reason: `Expected at most ${assertion.item_count_max} item(s), got ${items.length}`,
        items,
      };
    }

    if (items.length === 1 && items[0].confidence > assertion.confidence_max_if_present) {
      return {
        pass: false,
        reason: `Item was extracted with confidence ${items[0].confidence}, above the ${assertion.confidence_max_if_present} ceiling for an implausible/joking claim`,
        item: items[0],
      };
    }

    return { pass: true, items };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Run assertions for A5 fixture (one message, two distinct facts - expect 2 items)
 */
async function testA5() {
  console.log('\n=== A5: Two Facts in One Message ===');
  const fixture = loadFixture('a5-two-facts-one-message.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;
    if (items.length < assertion.item_count_min) {
      return {
        pass: false,
        reason: `Expected at least ${assertion.item_count_min} items, got ${items.length}`,
        items,
      };
    }

    const quoteSpans = new Set(items.map((i: any) => i.quote_text));
    if (assertion.distinct_quote_spans && quoteSpans.size < 2) {
      return {
        pass: false,
        reason: `Expected at least 2 distinct quote_text spans (the attendance fact and the challenge fact must not be fused into one quote), got ${quoteSpans.size}`,
        items,
      };
    }

    const gotKeys = new Set(items.map((i: any) => i.requirement_key));
    const missingKeys = (assertion.expected_requirement_keys as string[]).filter((k) => !gotKeys.has(k));
    if (missingKeys.length > 0) {
      return {
        pass: false,
        reason: `Expected requirement keys ${JSON.stringify(assertion.expected_requirement_keys)} to be represented; missing: ${JSON.stringify(missingKeys)}`,
        items,
      };
    }

    const anyOf = assertion.expected_any_of_requirement_keys as string[] | undefined;
    if (anyOf && !anyOf.some((k) => gotKeys.has(k))) {
      return {
        pass: false,
        reason: `Expected at least one of ${JSON.stringify(anyOf)} to be represented, none found`,
        items,
      };
    }

    return { pass: true, items };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Run assertions for A6 fixture (ambiguous unit - GR-4 - expect unit_ambiguous: true)
 */
async function testA6() {
  console.log('\n=== A6: Unit-Ambiguous Count ===');
  const fixture = loadFixture('a6-unit-ambiguous.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;
    if (items.length < assertion.item_count_min) {
      return {
        pass: false,
        reason: `Expected at least ${assertion.item_count_min} item(s), got ${items.length}`,
        items,
      };
    }

    const anyAmbiguous = items.some((i: any) => i.unit_ambiguous === assertion.unit_ambiguous);
    if (!anyAmbiguous) {
      return {
        pass: false,
        reason: `Expected at least one item with unit_ambiguous: ${assertion.unit_ambiguous}, none found`,
        items,
      };
    }

    return { pass: true, items };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Run assertions for C1a fixture (seeded prompt injection - expect 0 items)
 */
async function testC1a() {
  console.log('\n=== C1a: Seeded Prompt Injection ===');
  const fixture = loadFixture('c1a-injection.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    const assertion = fixture.expected_assertion;
    if (items.length !== assertion.item_count) {
      return {
        pass: false,
        reason: `Expected ${assertion.item_count} items (injection must be treated as inert data), got ${items.length}`,
        items,
      };
    }

    return { pass: true };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Run assertions for C3 fixture (quasi-identifier without explicit name -
 * must be caught by the LLM's own pii_detected flag OR the independent
 * regex backstop; the regex layer exists precisely because the LLM alone
 * cannot be trusted to catch every case)
 */
async function testC3() {
  console.log('\n=== C3: Quasi-Identifier Without Explicit Name ===');
  const fixture = loadFixture('c3-quasi-identifier.json');

  const sourceMaterials = [{ sourceRef: fixture.source_ref, text: fixture.source_text }];

  try {
    const items = await extractEvidence(sourceMaterials, fixture.requirement_keys);
    console.log(`Items extracted: ${items.length}`);

    if (items.length === 0) {
      return { pass: true, reason: 'No items extracted at all — nothing to flag as PII, trivially satisfies "still flagged or absent"' };
    }

    for (const item of items) {
      const regexSignal = detectPiiRegex(`${item.claim_text} ${item.quote_text}`);
      const piiDetected = item.pii_detected || regexSignal.detected;
      if (!piiDetected) {
        return {
          pass: false,
          reason: `Item for ${item.requirement_key} was not flagged as PII by either the LLM or the regex backstop`,
          item,
        };
      }
    }

    return { pass: true, items };
  } catch (e) {
    const error = e as any;
    return { pass: false, reason: `Extraction failed: ${error.message}`, error: e };
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('GrantProof Phase 2 Eval Smoke Tests');
  console.log('====================================\n');

  const results: any[] = [];

  // Run A1
  const a1Result = await testA1();
  results.push({ fixture: 'A1', ...a1Result });
  if (a1Result.pass) {
    console.log('✓ A1 PASS');
  } else {
    console.log(`✗ A1 FAIL: ${a1Result.reason}`);
  }

  // Run A2
  const a2Result = await testA2();
  results.push({ fixture: 'A2', ...a2Result });
  if (a2Result.pass) {
    console.log('✓ A2 PASS');
  } else {
    console.log(`✗ A2 FAIL: ${a2Result.reason}`);
  }

  // Run A3
  const a3Result = await testA3();
  results.push({ fixture: 'A3', ...a3Result });
  console.log(a3Result.pass ? '✓ A3 PASS' : `✗ A3 FAIL: ${a3Result.reason}`);

  // Run A4
  const a4Result = await testA4();
  results.push({ fixture: 'A4', ...a4Result });
  console.log(a4Result.pass ? '✓ A4 PASS' : `✗ A4 FAIL: ${a4Result.reason}`);

  // Run A5
  const a5Result = await testA5();
  results.push({ fixture: 'A5', ...a5Result });
  console.log(a5Result.pass ? '✓ A5 PASS' : `✗ A5 FAIL: ${a5Result.reason}`);

  // Run A6
  const a6Result = await testA6();
  results.push({ fixture: 'A6', ...a6Result });
  console.log(a6Result.pass ? '✓ A6 PASS' : `✗ A6 FAIL: ${a6Result.reason}`);

  // Run C1a
  const c1aResult = await testC1a();
  results.push({ fixture: 'C1a', ...c1aResult });
  console.log(c1aResult.pass ? '✓ C1a PASS' : `✗ C1a FAIL: ${c1aResult.reason}`);

  // Run C3
  const c3Result = await testC3();
  results.push({ fixture: 'C3', ...c3Result });
  console.log(c3Result.pass ? '✓ C3 PASS' : `✗ C3 FAIL: ${c3Result.reason}`);

  // Summary
  console.log('\n====================================');
  const passCount = results.filter((r: any) => r.pass).length;
  const totalCount = results.length;
  console.log(`Results: ${passCount}/${totalCount} fixtures passed`);

  if (passCount !== totalCount) {
    console.log('\nFailed fixtures details:');
    results
      .filter((r: any) => !r.pass)
      .forEach((r: any) => {
        console.log(`\n${r.fixture}:`);
        console.log(`  Reason: ${r.reason}`);
        if (r.item) {
          console.log(`  Item: ${JSON.stringify(r.item, null, 2)}`);
        }
        if (r.items) {
          console.log(`  Items: ${JSON.stringify(r.items, null, 2)}`);
        }
      });
    process.exit(1);
  } else {
    console.log('\n✓ All smoke tests passed!');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Eval harness failed:', e);
  process.exit(1);
});
