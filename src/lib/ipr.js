'use strict'

const Transport = require('./transport')
const oer = require('oer-utils')
const assert = require('assert')
const moment = require('moment')
const ILDCP = require('ilp-protocol-ildcp')
const compat = require('ilp-compat-plugin')
const base64url = require('../utils/base64url')
const cryptoHelper = require('../utils/crypto')
const { safeConnect } = require('../utils')

const IPR_VERSION = 2

/**
  * @module IPR
  */

/**
  * Create a packet and condition
  *
  * @param {Object} params Parameters for creating payment request
  * @param {String} params.destinationAmount Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String} params.destinationAccount Target account's ILP address
  * @param {Buffer} params.receiverSecret Secret for generating IPR packets
  * @param {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
  * @param {String} [params.expiresAt=60 seconds from now] Expiry of request
  * @param {Buffer} [params.data=null] Additional data to include in the request
  * @param {Object} [params.headers=null] Additional headers for private details. The key-value pairs represent header names and values.
  * @param {Object} [params.publicHeaders=null] Additional headers for public details. The key-value pairs represent header names and values.
  * @param {Boolean} [params.disableEncryption=false] Turns off encryption of private memos and data
  * @param {Number} [params.minFulfillRetryWait=250] Minimum amount of time (in ms) to wait before retrying fulfillment
  * @param {Number} [params.maxFulfillRetryWait=1000] Maximum amount of time (in ms) to wait before retrying fulfillment
  *
  * @return {Object} Packet and condition for use in the IPR protocol.
  */
function createPacketAndCondition (params) {
  assert(Buffer.isBuffer(params.receiverSecret), 'receiverSecret must be a buffer')

  // this secret is generated the same way as a PSK shared secret, but it is
  // not shared. The packet and condition are passed to the sender instead.
  const { token, receiverId, sharedSecret } =
    cryptoHelper.generatePskParams(params.receiverSecret)

  return Transport.createPacketAndCondition(Object.assign({
    expiresAt: params.expiresAt || moment().add(60, 'seconds').toISOString()
  }, params, {
    secret: Buffer.from(sharedSecret, 'base64'),
    destinationAccount: params.destinationAccount + '.' + receiverId + token
  }))
}

/**
  * Create an encoded IPR for use in the IPR transport protocol
  *
  * @param {Object} params Parameters for encoding IPR
  * @param {String} params.packet ILP packet of this IPR
  * @param {String} params.condition condition of this IPR
  *
  * @return {Buffer} encoded IPR buffer
  */
function encodeIPR ({
  packet,
  condition
}) {
  assert(packet, 'params.packet must be specified')
  assert(condition, 'params.condition must be specified')

  const packetBuf = Buffer.from(packet, 'base64')
  const conditionBuf = Buffer.from(condition, 'base64')

  assert(conditionBuf.length === 32, 'params.condition must encode 32 bytes')

  const writer = new oer.Writer()

  writer.writeUInt8(IPR_VERSION)
  writer.write(conditionBuf)
  writer.writeVarOctetString(packetBuf)

  return writer.getBuffer()
}

/**
  * Decode an IPR buffer for use in the IPR transport protocol
  *
  * @param {Buffer} ipr encoded IPR buffer
  *
  * @return {Object} Decoded IPR parameters, containing 'packet' and 'condition' as base64url strings.
  */
function decodeIPR (ipr) {
  assert(Buffer.isBuffer(ipr), 'ipr must be a buffer, got: ' + ipr)

  const reader = oer.Reader.from(ipr)
  const version = reader.readUInt8()
  assert(version === IPR_VERSION,
    'IPR version must be ' + IPR_VERSION + ', got: ' + version)

  const condition = base64url(reader.read(32))
  const packet = base64url(reader.readVarOctetString())

  return {
    condition,
    packet
  }
}

/**
  * Create a payment request for use in the IPR transport protocol.
  *
  * @param {Object} params Parameters for creating payment request
  * @param {String} params.destinationAmount Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String} params.destinationAccount Target account's ILP address
  * @param {Buffer} params.receiverSecret Secret for generating IPR packets
  * @param {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
  * @param {String} [params.expiresAt=60 seconds from now] Expiry of request
  * @param {Buffer} [params.data=null] Additional data to include in the request
  * @param {Object} [params.headers=null] Additional headers for private details. The key-value pairs represent header names and values.
  * @param {Object} [params.publicHeaders=null] Additional headers for public details. The key-value pairs represent header names and values.
  * @param {Object} [params.disableEncryption=false] Turns off encryption of private memos and data
  *
  * @return {Buffer} encoded IPR buffer for use in the IPR protocol
  */
function createIPR (params) {
  return encodeIPR(createPacketAndCondition(params))
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
  * @param {Buffer} params.receiverSecret Secret to generate fulfillments with
  * @param {Buffer} [params.allowOverPayment=true] Accept payments with higher amounts than expected
  * @param {IncomingCallback} callback Called after an incoming payment is validated.
  *
  * @return {Object} Payment request
  */
async function listen (plugin, params, callback) {
  plugin = compat(plugin)

  await safeConnect(plugin)
  const address = (await ILDCP.fetch(plugin.sendData.bind(plugin))).clientAddress
  return Transport.listen(plugin, Object.assign({ address }, params), callback)
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
  createIPR,
  encodeIPR,
  decodeIPR,
  listen,
  handleData
}
