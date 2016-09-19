module.exports = function (wallaby) {
  return {
    files: [
      'src/**/*.js',
      'index.js',
      'test/data/*',
      'test/mocks/*.js'
    ],

    tests: [
      'test/**/*Spec.js'
    ],

    testFramework: 'mocha',

    env: {
      type: 'node',
      runner: 'node'
    },

    bootstrap: function (wallaby) {
      require('co-mocha')(wallaby.testFramework.constructor)
    }
  }
}
