'use strict'

const Transport = require('./transport')
const cryptoHelper = require('../utils/crypto')
const assert = require('assert')
const base64url = require('../utils/base64url')

/**
  * @module PSK
  */

/**
  * Create a payment request using a Pre-Shared Key (PSK).
  *
  * @param {Object} params Parameters for creating payment request
  * @param {String} params.destinationAmount Amount that should arrive in the recipient's account
  * @param {String} params.destinationAccount Target account's ILP address
  * @param {String} params.sharedSecret Shared secret for PSK protocol
  * @param {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
  * @param {String} [params.expiresAt=30 seconds from now] Expiry of request
  * @param {Object} [params.data=null] Additional data to include in the request
  *
  * @return {Object} Payment request
  */
function createPacketAndCondition (rawParams) {
  const params = Object.assign({}, rawParams, { secret: rawParams.sharedSecret })
  return Transport.createPacketAndCondition(params, 'psk')
}

/**
  * Generate shared secret for Pre-Shared Key (PSK) transport protocol.
  *
  * @param {Object} params Parameters for creating PSK params
  * @param {String} params.destinationAccount The ILP address that will receive PSK payments
  * @param {Buffer} params.secretSeed secret used to generate the shared secret and the extra segments of destinationAccount
  *
  * @return {PskParams}
  */
function generateParams ({
  destinationAccount,
  secretSeed
}) {
  assert(typeof destinationAccount === 'string', 'destinationAccount must be a string')
  assert(Buffer.isBuffer(secretSeed), 'secretSeed must be a buffer')

  const token = base64url(cryptoHelper.getPskToken(secretSeed))
  const sharedSecret =
    base64url(cryptoHelper.getPskSharedSecret(secretSeed, token))

  const receiverId = base64url(cryptoHelper.getReceiverId(sharedSecret))

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
  * @param {Buffer} [params.allowOverPayment=false] Accept payments with higher amounts than expected
  * @param {IncomingCallback} callback Called after an incoming payment is validated.
  *
  * @return {Object} Payment request
  */
function listen (plugin, rawParams, callback) {
  const params = Object.assign({}, rawParams, { secret: rawParams.sharedSecret })
  return Transport.listen(plugin, params, callback, 'psk')
}

module.exports = {
  createPacketAndCondition,
  generateParams,
  listen
}
