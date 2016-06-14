'use strict'

const _ = require('lodash')
const EventEmitter = require('eventemitter2')

class MockClient extends EventEmitter {
  constructor (opts) {
    super()
    this.type = opts.type
    if (this.type === 'fake') {
      throw new Error('Cannot find module \'ilp-plugin-fake\'')
    }
    this.auth = opts.auth
    this.account = this.auth.account
    this.ledger = /(.+)\/accounts\/.+$/.exec(this.auth.account)[1]
  }

  getPlugin () {
    return {
      id: this.ledger,
      getAccount: () => Promise.resolve(this.account)
    }
  }

  connect () {

  }

  disconnect () {

  }

  waitForConnection () {
    return Promise.resolve()
  }

  createPayment (params) {
    return new MockPayment(this, params)
  }

  fulfillCondition (transferId, fulfillment) {
    if (typeof transferId === 'string' && typeof fulfillment === 'string') {
      return Promise.resolve(null)
    } else {
      return Promise.reject(new Error('fulfillCondition called with invalid arguments:', transferId, fulfillment))
    }
  }

  emitIncoming (transfer, fulfillment) {
    const t = _.merge({
      id: 'e99af93f-8c97-4f7f-bcfd-e1beef847c4f',
      direction: 'incoming',
      ledger: this.ledger,
      account: this.account,
      amount: '10',
      executionCondition: 'cc:0:3:ERFUgCWoa85FwZGDUuMFGB73RftgZjsAdFuDJcX1WnM:32',
      data: {
        ilp_header: {
          account: this.account,
          ledger: this.account,
          amount: '10',
          data: {
            id: '3cb34c81-5104-415d-8be8-138a22158a48',
            expiresAt: '1970-01-01T00:00:01.000Z',
            executionCondition: 'cc:0:3:ERFUgCWoa85FwZGDUuMFGB73RftgZjsAdFuDJcX1WnM:32',
            userData: {
              foo: 'bar'
            }
          }
        }
      }
    }, transfer || {})
    this.emit('receive', t, fulfillment)
  }
}

class MockPayment extends EventEmitter {
  constructor (client, params) {
    super()
    this.client = client
    this.params = params
  }

  quote () {
    if (this.params.destinationAccount === this.client.auth.account) {
      return Promise.reject(new Error('same ledger :/'))
    }
    return Promise.resolve({
      source_amount: this.params.sourceAmount || this.params.destinationAmount,
      destination_amount: this.params.destinationAmount || this.params.sourceAmount,
      source_expiry_duration: 10
    })
  }

  sendQuoted (quote) {
    return Promise.resolve()
  }

}

module.exports = {
  Client: MockClient,
  Payment: MockPayment
}
