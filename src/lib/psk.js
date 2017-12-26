'use strict'

const Details = require('../utils/details')
const Transport = require('./transport')
const cryptoHelper = require('../utils/crypto')
const assert = require('assert')

/**
  * @module PSK
  */

/**
  * Create a payment request using a Pre-Shared Key (PSK).
  *
  * @param {Object} params Parameters for creating payment request
  * @param {String} params.destinationAmount Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String} params.destinationAccount Target account's ILP address
  * @param {String} params.sharedSecret Shared secret for PSK protocol
  * @param {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
  * @param {String} [params.expiresAt=none] Expiry of request
  * @param {Buffer} [params.data=null] Additional data to include in the request
  * @param {Object} [params.headers=null] Additional headers for private PSK details. The key-value pairs represent header names and values.
  * @param {Object} [params.publicHeaders=null] Additional headers for public PSK details. The key-value pairs represent header names and values.
  * @param {Boolean} [params.disableEncryption=false] Turns off encryption of private memos and data
  * @param {Number} [params.minFulfillRetryWait=250] Minimum amount of time (in ms) to wait before retrying fulfillment
  * @param {Number} [params.maxFulfillRetryWait=1000] Maximum amount of time (in ms) to wait before retrying fulfillment
  *
  * @return {Object} Payment request
  */
function createPacketAndCondition (rawParams) {
  const params = Object.assign({}, rawParams, { secret: Buffer.from(rawParams.sharedSecret, 'base64') })
  return Transport.createPacketAndCondition(params)
}

/**
  * Generate shared secret for Pre-Shared Key (PSK) transport protocol.
  *
  * @param {Object} params Parameters for creating PSK params
  * @param {String} params.destinationAccount The ILP address that will receive PSK payments
  * @param {Buffer} params.receiverSecret secret used to generate the shared secret and the extra segments of destinationAccount
  *
  * @return {PskParams}
  */
function generateParams ({
  destinationAccount,
  receiverSecret
}) {
  assert(typeof destinationAccount === 'string', 'destinationAccount must be a string')
  assert(Buffer.isBuffer(receiverSecret), 'receiverSecret must be a buffer')

  const { token, sharedSecret, receiverId } =
    cryptoHelper.generatePskParams(receiverSecret)

  return {
    sharedSecret,
    destinationAccount: destinationAccount + '.' + receiverId + token
  }
}

/**
  * @callback IncomingCallback
  * @param {Object} params
  * @param {Object} params.transfer Raw transfer object emitted by plugin
  * @param {Object} params.data Decrypted data parsed from transfer
  * @param {String} params.destinationAccount destinationAccount parsed from ILP packet
  * @param {String} params.destinationAmount destinationAmount parsed from ILP packet
  * @param {Function} params.fulfill async function that fulfills the transfer when it is called
  */

/**
  * Listen on a plugin for incoming PSK payments, and auto-generate fulfillments.
  *
  * @param {Object} plugin Ledger plugin to listen on
  * @param {Object} params Parameters for creating payment request
  * @param {Buffer} params.sharedSecret Secret to generate fulfillments with
  * @param {Buffer} [params.allowOverPayment=true] Accept payments with higher amounts than expected
  * @param {IncomingCallback} callback Called after an incoming payment is validated.
  *
  * @return {Object} Payment request
  */
function listen (plugin, rawParams, callback) {
  const params = Object.assign({}, rawParams, { secret: rawParams.sharedSecret })
  return Transport.listen(plugin, params, callback, 'psk')
}

/**
 * Handle a transfer.
 *
 * This can be used for more advanced scenarios like large numbers of "virtual"
 * receivers where instantiating all of them would be prohibitively expensive in
 * terms of memory.
 *
 * @param {Object} params
 * @param {Plugin} params.plugin LPI2 plugin
 * @param {String} params.receiverSecret Private value of the receiver, must be different for each receiver
 * @param {Boolean} params.allowOverPayment Whether to allow overpayment, default to true
 * @param {Function} params.callback Function to decide whether to accept the transfer
 * @param {Transfer} transfer LPI2 Transfer object
 * @return {Promise<FulfillmentInfo>} Will return fulfillment info or throw if the transfer is rejected
 */
function handleData (params, transfer) {
  return Transport.handleData(params, transfer)
}

module.exports = {
  createPacketAndCondition,
  generateParams,
  listen,
  handleData,
  parseDetails: Details.parseDetails,
  createDetails: Details.createDetails,
  parsePacketAndDetails: Details.parsePacketAndDetails
}
