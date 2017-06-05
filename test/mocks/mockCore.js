'use strict'

const EventEmitter = require('eventemitter2')
const CustomError = require('custom-error-instance')

class Client extends EventEmitter {
  constructor (opts, additional) {
    super()
    this.account = opts.account
    this.additional = additional || {}

    const MissingFulfillmentError = CustomError('MissingFulfillmentError', { message: 'Missing fulfillment' })
    this.plugin = {
      getAccount: () => this.account,
      getInfo: () => ({
        currencyScale: 2
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

  quote (req) {
    return Promise.resolve({
      connectorAccount: this.additional.connector || "example.connie",
      sourceAmount: req.sourceAmount || "1000",
      destinationAmount: req.destinationAmount || "1000"
    })
  }
}

exports.Client = Client
