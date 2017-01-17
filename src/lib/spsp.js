'use strict'
const co = require('co')
const agent = require('superagent')

const Sender = require('./sender')
const IlpCore = require('ilp-core')
const PluginBells = require('ilp-plugin-bells')

/**
 * @module SPSP
 */

const _createPayment = (query, quote) => {
  return {
    sourceAmount: String(quote.sourceAmount),
    connectorAccount: quote.connectorAccount,
    destinationAmount: String(quote.destinationAmount),
    destinationAccount: query.address,
    receiverEndpoint: query.receiverEndpoint
  }
}

const _getHref = (res, field) => {
  for (let link of res.links) {
    if (link.rel === field) return link.href
  }
  throw new Error(field + ' not found in ' + JSON.stringify(res))
}

const _setup = function * (receiverEndpoint, amount) {
  return (yield agent
    .post(receiverEndpoint)
    .send({ amount })
    .set('Accept', 'application/json')).body
}

const _quote = function * (plugin, receiver, sourceAmount, destinationAmount) {
  if (!plugin) throw new Error('missing plugin')
  if (!receiver) throw new Error('missing receiver')

  const client = new IlpCore.Client(plugin)
  const queryInfo = yield _query(receiver)
  const quoteInfo = yield client.quote({
    destinationAccount: queryInfo.address,
    destinationAmount: destinationAmount,
    sourceAmount: sourceAmount
  })

  return _createPayment(queryInfo, quoteInfo)
}

const _query = function * (receiver) {
  const res = yield query(receiver)
  return {
    address: _getHref(res, 'https://interledger.org/rel/ilpAddress'),
    receiverEndpoint: _getHref(res, 'https://interledger.org/rel/receiver')
  }
}

const query = (receiver) => {
  return co(function * () {
    const host = receiver.split('@')[1]
    return (yield agent
      .get('https://' + host + '/.well-known/webfinger?resource=acct:' + receiver)
      .set('Accept', 'application/json')).body
  })
}

const quoteSource = (plugin, receiver, amount) => {
  return co(function * () {
    if (!amount) throw new Error('missing amount')
    return yield _quote(plugin, receiver, amount, undefined)
  })
}

const quoteDestination = (plugin, receiver, amount) => {
  return co(function * () {
    if (!amount) throw new Error('missing amount')
    return yield _quote(plugin, receiver, undefined, amount)
  })
}

const sendPayment = (plugin, payment) => {
  return co(function * () {
    if (!plugin) throw new Error('missing plugin')
    if (!payment) throw new Error('missing payment object')
    if (!payment.destinationAccount) throw new Error('missing payment.destinationAccount')
    if (!payment.destinationAmount) throw new Error('missing payment.destinationAmount')
    if (!payment.sourceAmount) throw new Error('missing payment.sourceAmount')
    if (!payment.connectorAccount) throw new Error('missing payment.connectorAccount')
    if (!payment.receiverEndpoint) throw new Error('missing payment.receiverEndpoint')

    const client = new IlpCore.Client(plugin)
    const request = yield _setup(payment.receiverEndpoint, payment.destinationAmount)
    const sender = Sender.createSender({ client })
    const fulfillment = yield sender.payRequest({
      sourceAmount: String(payment.sourceAmount),
      connectorAccount: payment.connectorAccount,
      destinationAmount: String(payment.destinationAmount),
      destinationAccount: request.address,
      destinationMemo: {
        data: request.data,
        expires_at: request.expires_at
      },
      expiresAt: request.expires_at,
      executionCondition: request.condition
    })

    return { fulfillment }
  })
}

/**
  * Parameters for an SPSP payment
  * @typedef {Object} SPSPPayment
  * @property {string} sourceAmount A decimal string, representing the amount that will be paid on the sender's ledger.
  * @property {string} destinationAmount A decimal string, represending the amount that the receiver will get on their ledger.
  * @property {string} destinationAccount The receiver's ILP address.
  * @property {string} connectorAccount The connector's account on the sender's ledger. The initial transfer on the sender's ledger is made to this account.
  * @property {string} receiverEndpoint The SPSP setup endpoint of the receiver.
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
    this.plugin = (new IlpCore.Client(Object.assign({
      _plugin: PluginBells
    }, opts))).getPlugin()

    /**
      * Get payment params via SPSP query and ILQP quote, based on source amount
      * @param {String} receiver webfinger identifier of receiver
      * @param {String} sourceAmount Amount that you will send
      * @returns {Promise.<SPSPPayment>} Resolves with the parameters that can be passed to sendPayment
      */
    this.quoteSource = quoteSource.bind(null, this.plugin)

    /**
      * Get payment params via SPSP query and ILQP quote, based on destination amount
      * @param {String} receiver webfinger identifier of receiver
      * @param {String} destinationAmount Amount that the receiver will get
      * @returns {Promise.<SPSPPayment>} Resolves with the parameters that can be passed to sendPayment
      */
    this.quoteDestination = quoteDestination.bind(null, this.plugin)

    /**
      * Sends a payment using the PaymentParams
      * @param {SPSPPayment} payment params, returned by quoteSource or quoteDestination
      * @returns {Promise.<PaymentResult>} Returns payment result
      */
    this.sendPayment = sendPayment.bind(null, this.plugin)

    /**
      * Performs SPSP query given a webfinger identifier
      * @param {String} receiver webfinger identifier of receiver
      * @returns {Promise.<Query>} SPSP query result
      */
    this.query = query
  }
}

module.exports = {
  Client,
  quoteSource,
  quoteDestination,
  query,
  sendPayment
}
