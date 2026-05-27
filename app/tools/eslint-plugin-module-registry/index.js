const noDirectModuleImport = require('./rules/no-direct-module-import');

const plugin = {
  rules: {
    'no-direct-module-import': noDirectModuleImport,
  },
};

module.exports = plugin;
