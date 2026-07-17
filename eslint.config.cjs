// This is a Node MCP server, not a React app — use the node entrypoint. The
// package's default (`.`) entry pulls in the React config, whose react-refresh
// plugin registration is broken under eslint-plugin-react-refresh@0.5.2 (ESM
// interop: rules live on `.default`), which crashes ESLint on startup.
const jhaConfig = require('eslint-config-jha-react-node/node');

const config = [
  {
    ignores: [
      'dist/',
      'node_modules/',
      'reference-projects/',
      // Vendored verbatim from justin-sdk; excluded from tsconfig too (see the
      // note there). Kept unmodified so it stays byte-identical to the SDK
      // template rather than forking. Tracked upstream as home-base-rii4.
      'scripts/setup-env.ts',
    ],
  },
  ...jhaConfig,
];

module.exports = config;
