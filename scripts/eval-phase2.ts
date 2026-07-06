#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { extractEvidence } from '../src/llm/gemini';

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
