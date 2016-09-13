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
      getInfo: () => ({
        scale: 2,
        precision: 10
      }),
      isConnected: () => true,
      rejectIncomingTransfer: () => {
        this.rejected = true
        return Promise.resolve()
      }
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
