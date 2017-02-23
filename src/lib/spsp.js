'use strict'
const co = require('co')
const agent = require('superagent')
const uuid = require('uuid/v4')

const Sender = require('./sender')
const IlpCore = require('ilp-core')

/**
 * @module SPSP
 */

const _getHref = (res, field) => {
  for (let link of res.links) {
    if (link.rel === field) return link.href
  }
  throw new Error(field + ' not found in ' + JSON.stringify(res))
}

const _getSPSPFromReceiver = function * (receiver) {
  const host = receiver.split('@')[1]
  const resource = (yield agent
    .get('https://' + host + '/.well-known/webfinger?resource=acct:' + receiver)
    .set('Accept', 'application/json')).body

  return _getHref(resource, 'https://interledger.org/rel/spsp/v1')
}

const _querySPSP = function * (receiver) {
  const endpoint = (receiver.indexOf('@') >= 0)
    ? (yield _getSPSPFromReceiver(receiver))
    : receiver

  return (yield agent
    .get(endpoint)
    .set('Accept', 'application/json')).body
}

const query = co.wrap(_querySPSP)

const _quote = function * ({ plugin, spsp, sourceAmount, destinationAmount, ilp }) {
  if (!plugin) throw new Error('missing plugin')
  if (!spsp.destination_account) throw new Error('missing destination account')
  if (!spsp.maximum_destination_amount) throw new Error('missing maximum destination amount')
  if (!spsp.minimum_destination_amount) throw new Error('missing minimum destination amount')

  const client = new IlpCore.Client(plugin, ilp)
  const quote = yield client.quote({
    destinationAddress: spsp.destination_account,
    destinationAmount,
    sourceAmount
  })

  if (!quote) {
    throw new Error('unable to get quote to destinationAddress ' +
      spsp.destination_account + ' with spsp parameters: ' +
      JSON.stringify(spsp))
  }

  if (+quote.destinationAmount > +spsp.maximum_destination_amount ||
      +quote.destinationAmount < +spsp.minimum_destination_amount) {
    throw new Error('Destination amount (' +
      quote.destinationAmount +
      ') is outside of range [' +
      spsp.maximum_destination_amount +
      ', ' +
      spsp.minimum_destination_amount +
      ']')
  }

  return quote
}

const _createPayment = (spsp, quote) => {
  return {
    id: uuid(),
    sourceAmount: quote.sourceAmount,
    destinationAmount: quote.destinationAmount,
    destinationAccount: spsp.destination_account,
    connectorAccount: quote.connectorAccount,
    spsp: spsp
  }
}

const quoteSource = (plugin, receiver, amount, ilp) => {
  return co(function * () {
    const spsp = yield _querySPSP(receiver)
    // quote by the source amount, leaving destination amount unspecified
    const quote = yield _quote({ plugin, spsp, sourceAmount: amount, ilp })
    return _createPayment(spsp, quote)
  })
}

const quoteDestination = (plugin, receiver, amount, ilp) => {
  return co(function * () {
    const spsp = yield _querySPSP(receiver)
    // quote by the destination amount, leaving source amount unspecified
    const quote = yield _quote({ plugin, spsp, destinationAmount: amount, ilp })
    return _createPayment(spsp, quote)
  })
}

const sendPayment = (plugin, payment, ilp) => {
  return co(function * () {
    if (!plugin) throw new Error('missing plugin')
    if (!payment) throw new Error('missing payment')
    if (!payment.spsp) throw new Error('missing SPSP response in payment')
    if (!payment.spsp.shared_secret) throw new Error('missing SPSP shared_secret')
    if (!payment.destinationAmount) throw new Error('missing destinationAmount')
    if (!payment.sourceAmount) throw new Error('missing sourceAmount')
    if (!payment.destinationAccount) throw new Error('missing destinationAccount')
    if (!payment.id) throw new Error('payment must have an id')

    const sender = Sender.createSender(Object.assign({
      client: (new IlpCore.Client(plugin))
    }, ilp))

    const request = sender.createRequest({
      id: payment.id,
      sharedSecret: payment.spsp.shared_secret,
      destinationAmount: payment.destinationAmount,
      destinationAccount: payment.spsp.destination_account,
      data: payment.data
    })

    const fulfillment = yield sender.payRequest({
      uuid: payment.id,
      sourceAmount: String(payment.sourceAmount),
      connectorAccount: payment.connectorAccount,
      destinationAmount: String(payment.destinationAmount),
      destinationAccount: request.address,
      destinationMemo: {
        data: request.data,
        expires_at: request.expires_at
      },
      executionCondition: request.condition,
      expiresAt: request.expires_at
    })

    return { fulfillment }
  })
}

/**
  * Parameters for an SPSP payment
  * @typedef {Object} SpspPayment
  * @property {id} id UUID to ensure idempotence between calls to sendPayment
  * @property {string} source_amount Decimal string, representing the amount that will be paid on the sender's ledger.
  * @property {string} destination_amount Decimal string, representing the amount that the receiver will be credited on their ledger.
  * @property {string} destination_account Receiver's ILP address.
  * @property {string} connector_account The connector's account on the sender's ledger. The initial transfer on the sender's ledger is made to this account.
  * @property {string} spsp SPSP response object, containing details to contruct transfers.
  * @property {string} data extra data to attach to transfer.
  */

/** SPSP Client */
class Client {
  /**
    * Create an SPSP client.
    * @param {Object} opts plugin options
    * @param {Function} opts._plugin (optional) plugin constructor. Defaults to PluginBells
    */
  constructor (opts) {
    // use ILP Core Client constructor to turn opts into plugin
    this.plugin = (new IlpCore.Client(Object.assign(opts))).getPlugin()

    /**
      * Get payment params via SPSP query and ILQP quote, based on source amount
      * @param {String} receiver webfinger identifier of receiver
      * @param {String} sourceAmount Amount that you will send
      * @returns {Promise.<SpspPayment>} Resolves with the parameters that can be passed to sendPayment
      */
    this.quoteSource = quoteSource.bind(null, this.plugin)

    /**
      * Get payment params via SPSP query and ILQP quote, based on destination amount
      * @param {String} receiver webfinger identifier of receiver
      * @param {String} destinationAmount Amount that the receiver will get
      * @returns {Promise.<SpspPayment>} Resolves with the parameters that can be passed to sendPayment
      */
    this.quoteDestination = quoteDestination.bind(null, this.plugin)

    /**
      * Sends a payment using the PaymentParams
      * @param {SpspPayment} payment params, returned by quoteSource or quoteDestination
      * @returns {Promise.<PaymentResult>} Returns payment result
      */
    this.sendPayment = sendPayment.bind(null, this.plugin)

    /**
      * Queries an SPSP endpoint
      * @param {String} receiver A URL or an account
      * @returns {Object} result Result from SPSP endpoint
      */
    this.query = query
  }
}

module.exports = {
  Client,
  quoteSource,
  quoteDestination,
  sendPayment,
  query
}
