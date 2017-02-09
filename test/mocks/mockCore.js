'use strict'

const EventEmitter = require('eventemitter2')
const CustomError = require('custom-error-instance')

class Client extends EventEmitter {
  constructor (opts) {
    super()
    this.account = opts.account

    const MissingFulfillmentError = CustomError('MissingFulfillmentError', { message: 'Missing fulfillment' })
    this.plugin = {
      getAccount: () => this.account,
      getInfo: () => ({
        scale: 2,
        precision: 10
      }),
      isConnected: () => true,
      rejectIncomingTransfer: () => {
        this.rejected = true
        return Promise.resolve()
      },
      getFulfillment: () => { throw new MissingFulfillmentError('not yet fulfilled') }
    }
    this.rejected = false
  }

  getPlugin () {
    return this.plugin
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
