import { defineConfig } from 'vitest/config'

// Live checks against public full nodes (testnet and mainnet). Gated by GRPC_TESTNET so they
// self-skip when unset. Run with: npm run test:integration
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
})
