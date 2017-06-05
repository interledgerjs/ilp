'use strict'
const EventEmitter2 = require('eventemitter2')

module.exports = class MockPlugin extends EventEmitter2 {
  constructor () {
    super()
  }

  connect () {
    return Promise.resolve(null)
  }

  getInfo () {
    return {
      prefix: 'test.example.',
      connectors: [ 'test.example.connie' ],
      currencyScale: 2
    }
  }

  getAccount () {
    return 'test.example.alice'
  }

  sendRequest () {
    return Promise.resolve(null)
  }

  sendTransfer () {
    return Promise.resolve(null)
  }

  rejectIncomingTransfer () {
    return Promise.resolve(null)
  }
}
