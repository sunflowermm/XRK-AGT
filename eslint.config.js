export default [
  // ESLint v9 Flat Config
  // 说明：项目原先使用 `.eslintrc.cjs` + `.eslintignore`（已在 ESLint v9 过时）。
  // 这里把关键配置迁移到 Flat Config，重点用于发现：空引用、未使用变量/函数、无效语法等问题。
  {
    ignores: [
      // Dependencies
      'node_modules/',
      '.pnpm-store/',
      '**/.venv/**',
      '**/site-packages/**',

      // Build outputs
      'dist/',
      'build/',
      'out/',
      '.next/',
      '.nuxt/',

      // Logs
      'logs/',
      '*.log',

      // Generated files
      '*.lock',
      'pnpm-lock.yaml',
      'package-lock.json',

      // Runtime data
      'data/server_bots/',
      'data/importsJson/',

      // Cache
      '.cache/',
      '.parcel-cache/',
      '.eslintcache',

      // Coverage
      'coverage/',
      '.nyc_output/',

      // TypeScript
      '**/*.d.ts',

      // Config files
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',

      // Core modules (exclude system-Core)
      'core/*',
      '!core/system-Core/',

      // Sub servers / third-party bundles
      'subserver/**',

      // Vendored libs
      'src/renderers/puppeteer/lib/**'
    ]
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Bot: 'readonly',
        logger: 'readonly',
        plugin: 'readonly',
        Renderer: 'readonly',
        segment: 'readonly'
      }
    },
    rules: {
      // 目标：定位“空引用 / 未使用函数(变量) / 明显无效代码”，避免被纯格式规则淹没
      'no-unreachable': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-extra-semi': 'error',
      'no-constant-condition': 'warn',

      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-alert': 'warn',

      // 明确冗余倾向
      'prefer-const': 'error',
      'no-var': 'error'
    }
  }
]

