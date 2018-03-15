'use strict'
const EventEmitter2 = require('eventemitter2')
const debug = require('debug')('ilp:mock-plugin')
const IldcpHelper = require('../helpers/ildcp')

class MockPlugin extends EventEmitter2 {
  constructor () {
    super()

    this._handler = null
  }

  connect () {
    return Promise.resolve(null)
  }

  async sendData (packet) {
    debug('send data. size=%s', packet.length)

    if (IldcpHelper.isIldcpRequest(packet)) {
      return IldcpHelper.createIldcpResponse({
        address: 'test.example.alice',
        currencyScale: 2,
        currencyCode: 'USD'
      })
    }

    return this.dataHandler ? this.dataHandler(packet) : Buffer.alloc(0)
  }

  sendMoney (amount) {
    debug('send money. amount=%s', amount)
    return Promise.resolve()
  }

  registerDataHandler (handler) {
    if (this._dataHandler) {
      throw new Error('Mock plugin already has a data handler')
    }
    this._dataHandler = handler
  }

  deregisterDataHandler () {
    this._dataHandler = null
  }

  registerMoneyHandler (handler) {
    if (this._moneyHandler) {
      throw new Error('Mock plugin already has a money handler')
    }
    this._moneyHandler = handler
  }

  deregisterMoneyHandler () {
    this._moneyHandler = null
  }
}

MockPlugin.version = 2

module.exports = MockPlugin
