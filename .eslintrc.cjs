module.exports = {
  env: {
    es2025: true,
    node: true
  },
  extends: ['standard'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      impliedStrict: true
    }
  },
  globals: {
    Bot: 'readonly',
    logger: 'readonly',
    plugin: 'readonly',
    Renderer: 'readonly',
    segment: 'readonly'
  },
  rules: {
    // TypeScript风格规则
    'prefer-const': 'error',
    'no-var': 'error',
    'prefer-arrow-callback': 'warn',
    'prefer-template': 'warn',
    'object-shorthand': 'warn',
    'prefer-destructuring': ['warn', { array: false, object: true }],
    
    // 严格性规则
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-debugger': 'warn',
    'no-alert': 'warn',
    
    // 代码质量
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'curly': ['error', 'all'],
    'brace-style': ['error', '1tbs', { allowSingleLine: false }],
    'arrow-body-style': ['warn', 'as-needed'],
    'prefer-rest-params': 'warn',
    'prefer-spread': 'warn',
    
    // 最佳实践
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-return-await': 'error',
    'require-await': 'warn',
    'no-throw-literal': 'error',
    
    // 风格一致性
    'comma-dangle': ['error', 'never'],
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'quote-props': ['error', 'as-needed'],
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }]
  }
};