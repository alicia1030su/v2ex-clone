import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

/**
 * v0.0.21 low-memory unit entry.
 *
 * The normal `test:unit:low` path retains the full application setup. The
 * dedicated dev-memory workflow sets WORKBUDDY_MEMORY_TEST=1 because its tests
 * only exercise pure tooling and must not require PostgreSQL/Redis services.
 * This override never changes test discovery or testIgnore.
 */
const toolingOnly = process.env.WORKBUDDY_MEMORY_TEST === '1';

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    ...(toolingOnly
      ? {
          setupFiles: [],
          globalSetup: [],
        }
      : {}),
  },
});
