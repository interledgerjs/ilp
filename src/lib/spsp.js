'use strict'
const assert = require('assert')
const agent = require('superagent')
const uuid = require('uuid/v4')
const moment = require('moment')
const BigNumber = require('bignumber.js')
const compat = require('ilp-compat-plugin')
const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp:spsp')

const ILQP = require('./ilqp')
const PSK = require('./psk')
const { xor } = require('../utils')

const toInteger = (d, s) => (new BigNumber(d)).shift(s).round().toString()
const toDecimal = (i, s) => (new BigNumber(i)).shift(-s).toString()

/**
 * @module SPSP
 */

const _getHref = (res, field) => {
  for (let link of res.links) {
    if (link.rel === field) return link.href
  }
  throw new Error(field + ' not found in ' + JSON.stringify(res))
}

const _getSPSPFromReceiver = async function (receiver) {
  const host = receiver.split('@')[1]
  const resource = (await agent
    .get('https://' + host + '/.well-known/webfinger?resource=acct:' + receiver)
    .set('Accept', 'application/json')).body

  return _getHref(resource, 'https://interledger.org/rel/spsp/v2')
}

const _querySPSP = async function (receiver) {
  const endpoint = (receiver.indexOf('@') >= 0)
    ? (await _getSPSPFromReceiver(receiver))
    : receiver

  const response = (await agent
    .get(endpoint)
    .set('Accept', 'application/json')).body

  validateSPSPResponse(response)
  return response
}

/**
  * Validate a server's SPSP response, and throw an error if it's wrong.
  *
  * @param {Promise<SpspResponse>} SPSP SPSP response from server
  */

function validateSPSPResponse (response) {
  assert(typeof response === 'object', 'response must be a JSON object')
  assert(typeof response.destination_account === 'string', 'destination_account must be a string')
  assert(typeof response.shared_secret === 'string', 'shared_secret must be a string')
  assert(response.shared_secret.match(/^[A-Za-z0-9_-]+$/), 'shared_secret must be base64url')
  assert(Buffer.from(response.shared_secret, 'base64').length === 16, 'shared_secret must be 16 bytes')
  assert(typeof response.maximum_destination_amount === 'string', 'maximum_destination_amount must be a string')
  assert(typeof response.minimum_destination_amount === 'string', 'minimum_destination_amount must be a string')
  assert(typeof response.ledger_info === 'object', 'ledger_info must be an object')
  assert(typeof response.ledger_info.currency_code === 'string', 'ledger_info.currency_code must be a string')
  assert(typeof response.ledger_info.currency_scale === 'number', 'ledger_info.currency_scale must be a number')
  assert(typeof response.receiver_info === 'object', 'receiver_info must be an object')
}

const _createPayment = (plugin, sourceScale, spsp, quote, id) => {
  const sourceAmount =
    toDecimal(quote.sourceAmount, sourceScale)
  const destinationAmount =
    toDecimal(quote.destinationAmount, spsp.ledger_info.currency_scale)

  return {
    id: id || uuid(),
    sourceScale,
    sourceAmount: sourceAmount,
    destinationAmount: destinationAmount,
    destinationAccount: spsp.destination_account,
    sourceExpiryDuration: quote.sourceExpiryDuration,
    spsp: spsp
  }
}

/**
  * Query an SPSP endpoint and get SPSP details
  *
  * @param {String} receiver webfinger account identifier (eg. 'alice@example.com') or URL to SPSP endpoint.
  *
  * @return {Promise<SpspResponse>} SPSP SPSP response from server
  */

const query = _querySPSP

/**
  * Quote to an SPSP receiver
  *
  * @param {Object} plugin Ledger plugin used for quoting.
  * @param {Object} params Quote parameters
  * @param {String} params.receiver webfinger account identifier (eg. 'alice@example.com') or URL to SPSP endpoint.
  * @param {String} [params.sourceAmount] source amount to quote. This is a decimal, NOT an integer. It will be shifted by the sending ledger's scale to get the integer amount.
  * @param {String} [params.destinationAmount] destination amount to quote. This is a decimal, NOT an integer. It will be shifted by the receiving ledger's scale to get the integer amount.
  * @param {Array} [params.connectors=[]] connectors to quote. These will be supplied by plugin.getInfo if left unspecified.
  * @param {String} [params.id=uuid()] id to use for payment. sending a payment with the same id twice will be idempotent. If left unspecified, the id will be generated randomly.
  * @param {Number} [params.timeout=5000] how long to wait for a quote response (ms).
  * @param {SpspResponse} [params.spspResponse=SPSP.query(params.receiver)] SPSP response. The receiver endpoint will be queried automatically if this isn't supplied.
  *
  * @returns {Promise<SpspPayment>} SPSP payment object to be sent.
  */

const quote = async function (plugin, {
  receiver,
  sourceAmount,
  sourceScale,
  destinationAmount,
  connectors,
  id,
  timeout,
  spspResponse
}) {
  plugin = compat(plugin)

  assert(plugin, 'missing plugin')
  assert(receiver || spspResponse,
    'receiver or spspResponse must be specified')
  assert(xor(sourceAmount, destinationAmount),
    'destinationAmount or sourceAmount must be specified')
  assert(typeof sourceScale === 'number', 'sourceScale must be specified')
  if (spspResponse) validateSPSPResponse(spspResponse)

  const integerSourceAmount = sourceAmount &&
    toInteger(sourceAmount, sourceScale)

  const spsp = spspResponse || (await _querySPSP(receiver))
  const destinationScale = spsp.ledger_info.currency_scale
  const integerDestinationAmount = destinationAmount &&
    toInteger(destinationAmount, destinationScale)

  const quote = await ILQP.quote(plugin, {
    destinationAddress: spsp.destination_account,
    destinationAmount: integerDestinationAmount,
    sourceAmount: integerSourceAmount,
    connectors,
    timeout
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

  return _createPayment(plugin, sourceScale, spsp, quote, id)
}

/**
  * Quote to an SPSP receiver
  *
  * @param {Object} plugin Ledger plugin used for quoting.
  * @param {SpspPayment} payment SPSP Payment returned from SPSP.quote.
  *
  * @return {Promise<Object>} result The result of the payment.
  * @return {String} result.fulfillment The fulfillment of the payment.
  */

async function sendPayment (plugin, payment) {
  assert(plugin, 'missing plugin')
  plugin = compat(plugin)

  // CAUTION1: `destination` here means the final receiver, not the next hop.
  // CAUTION2: `source` here actually means "next" (first) hop, seen from the sender.
  assert(payment, 'missing payment')
  assert(payment.spsp, 'missing SPSP response in payment')
  assert(payment.spsp.shared_secret, 'missing SPSP shared_secret')
  assert(payment.destinationAmount, 'missing destinationAmount')
  assert(payment.sourceAmount, 'missing sourceAmount')
  assert(payment.destinationAccount, 'missing destinationAccount')
  assert(payment.sourceExpiryDuration, 'missing sourceExpiryDuration')
  assert(payment.id, 'payment must have an id')

  const sourceScale = payment.sourceScale
  const integerSourceAmount =
    toInteger(payment.sourceAmount, sourceScale)

  const data = JSON.stringify(payment.memo || {})
  const destinationScale = payment.spsp.ledger_info.currency_scale
  const integerDestinationAmount =
    toInteger(payment.destinationAmount, destinationScale)

  const { packet, condition } = PSK.createPacketAndCondition({
    sharedSecret: Buffer.from(payment.spsp.shared_secret, 'base64'),
    destinationAmount: integerDestinationAmount,
    destinationAccount: payment.destinationAccount,
    publicHeaders: payment.publicHeaders,
    headers: Object.assign({
      'Content-Length': data.length,
      'Content-Type': 'application/json'
    }, payment.headers),
    disableEncryption: payment.disableEncryption,
    data: Buffer.from(data, 'utf8')
  })

  try {
    debug('attempting payment %s with condition %s', payment.id, condition.toString('base64'))
    const result = await plugin.sendData(IlpPacket.serializeIlpPrepare({
      amount: integerSourceAmount,
      executionCondition: condition,
      destination: payment.destinationAccount,
      data: packet,
      expiresAt: moment()
        .add(payment.sourceExpiryDuration, 'seconds')
        .toDate()
    }))

    if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
      debug('payment %s succeeded', payment.id)
      const { fulfillment, data } = IlpPacket.deserializeIlpFulfill(result)
      return { fulfillment, data }
    } else if (result[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
      const { message } = IlpPacket.deserializeIlpReject(result)
      debug('payment rejected. paymentId=%s errorMessage=%s', payment.id, message)
      throw new Error('payment rejected: ' + message)
    } else {
      throw new Error('invalid packet type returned. type=' + result[0])
    }
  } catch (err) {
    debug('payment %s failed: ' + err, payment.id)
    if (err instanceof Object) {
      err.message = 'transfer ' + payment.id + ' failed: ' + err.message
    }
    throw err
  }
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
  * @property {Object} [publicHeaders={}] public headers for PSK data. The key-value pairs represent header names and values.
  * @property {Object} [headers={}] headers for PSK data. The key-value pairs represent header names and values.
  * @property {Object} [memo={}] arbitrary JSON object for additional data.
  */

/**
  * SPSP query response
  * @typedef {Object} SpspResponse
  * @property {string} destination_account The ILP address which will receive payments.
  * @property {string} shared_secret Base64url encoded 16-byte shared secret for use in PSK.
  * @property {string} maximum_destination_amount Integer string representing the maximum that the receiver will be willing to accept.
  * @property {string} minimum_destination_amount Integer string representing the minimum that the receiver will be willing to accept.
  * @property {Object} ledger_info An object containing the receiver's ledger metadata.
  * @property {string} ledger_info.currency_code The currency code of the receiver's ledger.
  * @property {string} ledger_info.currency_scale The currency scale of the receiver's ledger.
  * @property {Object} receiver_info Additional information containing arbitrary fields.
  */

module.exports = {
  _getHref,
  _getSPSPFromReceiver,
  _querySPSP,
  _createPayment,
  quote,
  sendPayment,
  query,
  validateSPSPResponse
}
