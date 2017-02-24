'use strict'

const Transport = require('./transport')

/**
  * @module IPR
  */

/**
  * Create a payment request for use in the IPR transport protocol.
  *
  * @param {Object} params Parameters for creating payment request
  * @param {String} params.destinationAmount Amount that should arrive in the recipient's account
  * @param {String} params.destinationAccount Target account's ILP address
  * @param {String} params.secret Secret for generating IPR packets
  * @param {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
  * @param {String} [params.expiresAt=30 seconds from now] Expiry of request
  * @param {Object} [params.data=null] Additional data to include in the request
  *
  * @return {Object} Payment request
  */
function createPacketAndCondition (params) {
  return Transport.createPacketAndCondition(params, 'ipr')
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
  * Listen on a plugin for incoming IPR payments, and auto-generate fulfillments.
  *
  * @param {Object} plugin Ledger plugin to listen on
  * @param {Object} params Parameters for creating payment request
  * @param {Buffer} params.secret Secret to generate fulfillments with
  * @param {Buffer} [params.allowOverPayment=false] Accept payments with higher amounts than expected
  * @param {IncomingCallback} callback Called after an incoming payment is validated.
  *
  * @return {Object} Payment request
  */
function listen (plugin, params, callback) {
  return Transport.listen(plugin, params, callback, 'ipr')
}

module.exports = {
  createPacketAndCondition,
  listen
}
