import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

// Layering: protocol is environment-agnostic (no DOM, React, Electron or
// Node), transport depends only on protocol, and the UI reaches the protocol
// only through the worker client and stores. This keeps the protocol core
// testable in plain Node and shared between the browser and Electron builds.
export default tseslint.config(
  { ignores: ['dist/', 'dist-web/', 'dist-electron/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      // A leading underscore marks a parameter required by an interface but
      // unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/protocol',
              from: [
                './src/ui',
                './src/transport',
                './src/stores',
                './src/services',
                './src/worker',
                './electron',
              ],
              message: 'protocol/ must stay environment-agnostic: bytes in, typed messages out.',
            },
            {
              target: './src/transport',
              from: ['./src/ui', './src/stores', './src/services'],
              message: 'transport/ may depend on protocol types only.',
            },
            {
              target: './src/ui',
              from: ['./src/protocol'],
              except: ['./types.ts'],
              message:
                'ui/ talks to the protocol through worker-client and stores, never directly.',
            },
          ],
        },
      ],
    },
  },
)
