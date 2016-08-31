'use strict'

const EventEmitter = require('eventemitter2')

class Client extends EventEmitter {
  constructor (opts) {
    super()
    this.account = opts.account
  }

  getPlugin () {
    return {
      getAccount: () => Promise.resolve(this.account),
      isConnected: () => true
    }
  }

  connect () {
    return Promise.resolve()
  }

  disconnect () {
    return Promise.resolve()
  }

  waitForConnection () {
    return Promise.resolve()
  }

  fulfillCondition () {
    return Promise.resolve()
  }

  quote () {
    return Promise.resolve()
  }

  sendQuotedPayment () {
    return Promise.resolve()
  }
}

exports.Client = Client
