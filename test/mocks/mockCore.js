'use strict'

const EventEmitter = require('eventemitter2')

class Client extends EventEmitter {
  constructor (opts) {
    super()
    this.account = opts.account
  }

  getPlugin () {
    return {
      getAccount: () => this.account
    }
  }

  connect () {
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
