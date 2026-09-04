import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is build output; `loadtest` runs under k6, which injects its own
  // globals (__ENV) that ESLint cannot know about — it is linted by k6, not here.
  globalIgnores(['dist', 'loadtest']),

  // Frontend — browser globals, JSX and the React rules.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Backend — CommonJS modules on Node, no React. Previously excluded from lint
  // entirely; now covered so backend mistakes are caught in CI like the rest.
  {
    files: ['server/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
      ecmaVersion: 2023,
    },
    rules: {
      // `_`-prefixed args are intentionally unused (e.g. the `_next` an Express
      // error handler must declare to be recognised by its 4-arg arity), and
      // `const { secret, ...rest } = obj` is the idiom for omitting a field.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
])
