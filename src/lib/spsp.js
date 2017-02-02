'use strict'
const co = require('co')
const agent = require('superagent')
const uuid = require('uuid/v4')

const Sender = require('./sender')
const IlpCore = require('ilp-core')
const PluginBells = require('ilp-plugin-bells')

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
  const endpoint = (receiver.indexOf('@') >= 0) ?
    _getSPSPFromReceiver(receiver) :
    receiver

  return (yield agent
    .get(endpoint)
    .set('Accept', 'application/json')).body
}

const _quote = function * (plugin, spsp, sourceAmount, destinationAmount) {
  if (!plugin) throw new Error('missing plugin')
  if (!destinationAccount) throw new Error('missing receiver')

  const client = new IlpCore.Client(plugin)
  const quote = yield client.quote({
    destinationAccount: spsp.payment.destination_amount,
    destinationAmount,
    sourceAmount
  })

  if (quote.destinationAmount > spsp.payment.maximum_destination_amount ||
      quote.destinationAmount < spsp.payment.minimum_destination_amount) {
    throw new Error('Destination amount (' +
      quote.destinationAmount +
      ') is outside of range [' +
      spsp.payment.maximum_destination_amount +
      ', ' +
      spsp.minimum_destination_amount +
      ']')
  }

  return quote
}

const _createPayment = (spsp, quote) => {
  return {
    id: uuid(),
    source_amount: quote.sourceAmount,
    destination_amount: quote.destinationAmount,
    destination_account: quote.destinationAccount,
    connector_account: quote.connectorAccount,
    spsp: spsp
  }
}

const quoteSource = (plugin, receiver, amount) {
  return co(function * () {
    const spsp = yield _querySPSP(receiver)
    const quote = yield _quote(plugin, spsp, amount)
    return _createPayment(spsp, quote)
  })
}

const quoteDestination = (plugin, receiver, amount) {
  return co(function * () {
    const spsp = yield _querySPSP(receiver)
    const quote = yield _quote(plugin, spsp, amount)
    return _createPayment(spsp, quote)
  })
}

const sendPayment = (plugin, payment) {
  return co(function * () {
    const sender = Sender.createSender({
      client: (new IlpCore.Client(plugin))
    })

    const request = sender.createRequest({
      id: payment.id,
      shared_secret: payment.spsp.payment.shared_secret,
      destination_amount: payment.destination_amount,
      destination_account: payment.destination_account,
    })

    const fulfillment = yield sender.payRequest({
      uuid: payment.id,
      sourceAmount: String(payment.source_amount),
      connectorAccount: payment.connector_account,
      destinationAmount: String(payment.destination_amount),
      destinationAccount: request.address,
      executionCondition: request.condition,
      expiresAt: request.expires_at
    })

    return { fulfillment }
  })
}

/**
  * Parameters for an SPSP payment
  * @typedef {Object} SPSPPayment
  * @property {id} id UUID to ensure idempotence between calls to sendPayment
  * @property {string} source_amount Decimal string, representing the amount that will be paid on the sender's ledger.
  * @property {string} destination_amount Decimal string, representing the amount that the receiver will be credited on their ledger.
  * @property {string} destination_account Receiver's ILP address.
  * @property {string} connector_account The connector's account on the sender's ledger. The initial transfer on the sender's ledger is made to this account.
  * @property {string} spsp SPSP response object, containing details to contruct transfers.
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
  }
}

module.exports = {
  Client,
  quoteSource,
  quoteDestination,
  sendPayment
}
