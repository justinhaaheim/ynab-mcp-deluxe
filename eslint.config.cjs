const jhaConfig = require('eslint-config-jha-react-node');

const config = [
  {ignores: ['dist/', 'node_modules/', 'reference-projects/']},
  ...jhaConfig,
];

module.exports = config;
