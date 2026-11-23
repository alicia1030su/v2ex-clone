import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * v0.0.21 low-memory Playwright entry.
 *
 * Discovery, projects, retries, and testIgnore are inherited unchanged. Only
 * worker cardinality and file parallelism are forced to one.
 */
export default defineConfig({
  ...baseConfig,
  fullyParallel: false,
  workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  reporter: [
    ['list'],
    ['json', { outputFile: `${process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results'}/e2e-results.json` }],
  ],
});
