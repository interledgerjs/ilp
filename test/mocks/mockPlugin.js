'use strict'
const EventEmitter2 = require('eventemitter2')
const debug = require('debug')('ilp:mock-plugin')

class MockPlugin extends EventEmitter2 {
  constructor () {
    super()

    this._handler = null
  }

  connect () {
    return Promise.resolve(null)
  }

  getInfo () {
    return {
      currencyScale: 2
    }
  }

  getAccount () {
    return 'test.example.alice'
  }

  sendRequest (request) {
    debug('send request %j', request)
    return Promise.resolve(null)
  }

  sendTransfer (transfer) {
    debug('send transfer %j', transfer)
    return Promise.resolve(null)
  }

  registerTransferHandler (handler) {
    if (this._handler) {
      throw new Error('Mock plugin already has a transfer handler')
    }
    this._handler = handler
  }

  deregisterTransferHandler (handler) {
    this._handler = null
  }
}

MockPlugin.version = 2

module.exports = MockPlugin
