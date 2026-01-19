const jhaConfig = require('eslint-config-jha-react-node');

const config = [{ignores: ['dist/', 'node_modules/']}, ...jhaConfig];

module.exports = config;
