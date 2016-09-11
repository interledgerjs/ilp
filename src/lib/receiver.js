'use strict'

const crypto = require('crypto')
const uuid = require('node-uuid')
const moment = require('moment')
const stringify = require('canonical-json')
const Client = require('ilp-core').Client
const EventEmitter = require('eventemitter2')
const debug = require('debug')('ilp:receiver')
const BigNumber = require('bignumber.js')

/**
 * @module Receiver
 */

/**
 * Returns an ILP Receiver to create payment requests,
 * listen for incoming transfers, and automatically fulfill conditions
 * of transfers paying for the payment requests created by the Receiver.
 *
 * @param  {LedgerPlugin} opts._plugin Ledger plugin used to connect to the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {Object}  opts Plugin parameters, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {ilp-core.Client} [opts.client=create a new instance with the plugin and opts] [ilp-core](https://github.com/interledger/js-ilp-core) Client, which can optionally be supplied instead of the previous options
 * @param  {Buffer} [opts.hmacKey=crypto.randomBytes(32)] 32-byte secret used for generating request conditions
 * @param  {Number} [opts.defaultRequestTimeout=30] Default time in seconds that requests will be valid for
 * @param  {Boolean} [opts.allowOverPayment=false] Allow transfers where the amount is greater than requested
 * @param  {Number} [opts.connectionTimeout=10] Time in seconds to wait for the ledger to connect
 * @return {Receiver}
 */
function createReceiver (opts) {
  const client = opts.client || new Client(opts)

  const eventEmitter = new EventEmitter({
    wildcard: true
  })

  if (opts.hmacKey && (!Buffer.isBuffer(opts.hmacKey) || opts.hmacKey.length < 32)) {
    throw new Error('hmacKey must be 32-byte Buffer if supplied')
  }
  const hmacKey = opts.hmacKey || crypto.randomBytes(32)
  const defaultRequestTimeout = opts.defaultRequestTimeout || 30
  const allowOverPayment = !!opts.allowOverPayment
  const connectionTimeout = opts.connectionTimeout || 10
  // the following details are set on listen
  let account
  let scale
  let precision

  /**
   * Get ILP address
   *
   * @return {String}
   */
  function getAddress () {
    if (!client.getPlugin().isConnected()) {
      throw new Error('receiver must be connected to get address')
    }
    return account
  }
  /**
   * Create a payment request
   *
   * @param  {String} params.amount Amount to request
   * @param  {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
   * @param  {String} [params.expiresAt=30 seconds from now] Expiry of request
   * @param  {Object} [params.data=null] Additional data to include in the request
   * @return {Object}
   */
  function createRequest (params) {
    if (!client.getPlugin().isConnected()) {
      throw new Error('receiver must be connected to create requests')
    }

    if (!params.amount) {
      throw new Error('amount is required')
    }
    const amount = new BigNumber(params.amount)
    if (amount.decimalPlaces() > scale) {
      throw new Error('request amount has more decimal places than the ledger supports (' + scale + ')')
    }
    if (amount.precision() > precision) {
      throw new Error('request amount has more significant digits than the ledger supports (' + precision + ')')
    }

    if (params.expiresAt && !moment(params.expiresAt, moment.ISO_8601).isValid()) {
      throw new Error('expiresAt must be an ISO 8601 timestamp')
    }

    const paymentRequest = {
      address: account + '.' + (params.id || uuid.v4()),
      amount: amount.toString(),
      expires_at: params.expiresAt || moment().add(defaultRequestTimeout, 'seconds').toISOString()
    }

    if (params.data) {
      paymentRequest.data = params.data
    }

    const conditionPreimage = generateConditionPreimage(hmacKey, paymentRequest)
    paymentRequest.condition = toConditionUri(conditionPreimage)

    return paymentRequest
  }

  /**
   * @private
   * @param {String} transferId
   * @param {String} rejectionMessage
   * @returns {Promise<String>} the rejection message
   */
  function rejectIncomingTransfer (transferId, rejectionMessage) {
    return client.getPlugin()
      .rejectIncomingTransfer(transferId, rejectionMessage)
      .then(() => rejectionMessage)
  }

  /**
   * @private
   *
   * When we receive transfer notifications, check the transfers
   * and try to fulfill the conditions (which will only work if
   * they correspond to requests we created)
   *
   * Note return values are only for testing
   */
  function autoFulfillConditions (transfer) {
    if (transfer.cancellationCondition) {
      debug('got notification of transfer with cancellationCondition', transfer)
      return rejectIncomingTransfer(transfer.id, 'cancellation')
    }

    if (!transfer.executionCondition) {
      debug('got notification of transfer without executionCondition ', transfer)
      return rejectIncomingTransfer(transfer.id, 'no-execution')
    }

    // The payment request is extracted from the ilp_header
    let packet = transfer.data && transfer.data.ilp_header

    if (!packet) {
      debug('got notification of transfer with no packet attached')
      return rejectIncomingTransfer(transfer.id, 'no-packet')
    }

    const paymentRequest = {
      address: packet.account,
      amount: packet.amount,
      expires_at: packet.data && packet.data.expires_at
    }

    if (packet.data && packet.data.data) {
      paymentRequest.data = packet.data.data
    }

    if ((new BigNumber(transfer.amount)).lessThan(packet.amount)) {
      debug('got notification of transfer where amount is less than expected (' + packet.amount + ')', transfer)
      return rejectIncomingTransfer(transfer.id, 'insufficient')
    }

    if (!allowOverPayment && (new BigNumber(transfer.amount)).greaterThan(packet.amount)) {
      debug('got notification of transfer where amount is greater than expected (' + packet.amount + ')', transfer)
      return rejectIncomingTransfer(transfer.id, 'overpayment-disallowed')
    }

    if (paymentRequest.expires_at && moment().isAfter(paymentRequest.expires_at)) {
      debug('got notification of transfer with expired packet', transfer)
      return rejectIncomingTransfer(transfer.id, 'expired')
    }

    const conditionPreimage = generateConditionPreimage(hmacKey, paymentRequest)

    if (transfer.executionCondition !== toConditionUri(conditionPreimage)) {
      debug('got notification of transfer where executionCondition does not match the one we generate (' + toConditionUri(conditionPreimage) + ')', transfer)
      return rejectIncomingTransfer(transfer.id, 'condition-mismatch')
    }

    const fulfillment = toFulfillmentUri(conditionPreimage)
    debug('about to submit fulfillment: ' + fulfillment)
    // returning the promise is only so the result is picked up by the tests' emitAsync
    return client.fulfillCondition(transfer.id, fulfillment)
      .then(() => {
        const requestId = paymentRequest.address.replace(account + '.', '')
        debug('successfully submitted fulfillment ' + fulfillment + ' for request ' + requestId + ' (transfer ' + transfer.id + ')')

        /**
         * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string
         *
         * @event incoming
         * @type {object}
         */
        eventEmitter.emit('incoming', transfer, fulfillment)

        /**
         * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string for a specific request
         *
         * @event incoming:requestid
         * @type {object}
         */
        // Allow listeners for specific requests and on wildcard events such that
        // `incoming:appid.*` will match `incoming:appid:requestid`
        eventEmitter.emit('incoming:' + requestId, transfer, fulfillment)

        return 'sent'
      })
      .catch((err) => {
        debug('error submitting fulfillment', err)
      })
  }

  /**
   * Listen for incoming transfers and automatically fulfill
   * conditions for transfers corresponding to requests this
   * receiver created.
   *
   * @fires incoming
   * @fires incoming:requestid
   *
   * @return {Promise.<null>} Resolves when the receiver is connected
   */
  function listen () {
    // don't have multiple listeners even if listen is called more than once
    client.removeListener('incoming_prepare', autoFulfillConditions)
    client.on('incoming_prepare', autoFulfillConditions)
    return Promise.race([
      client.connect()
        .then(() => client.waitForConnection())
        .then(() => Promise.all([
          client.getPlugin().getAccount(),
          client.getPlugin().getInfo()
        ]))
        .then((details) => {
          debug('account: ' + details[0] + ' ledger info: ', details[1])
          account = details[0]
          scale = details[1].scale
          precision = details[1].precision
        })
        .then(() => debug('receiver listening')),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Ledger connection timed out')), connectionTimeout * 1000)
      })
    ])
  }

  /**
   * Disconnect from the ledger and stop listening for events.
   *
   * @return {Promise.<null>} Resolves when the receiver is disconnected.
   */
  function stopListening () {
    client.removeListener('incoming_prepare', autoFulfillConditions)
    return client.disconnect()
  }

  return Object.assign(eventEmitter, {
    getAddress,
    createRequest,
    listen,
    stopListening
  })
}

function generateConditionPreimage (hmacKey, request) {
  const hmac = crypto.createHmac('sha256', hmacKey)
  const jsonString = stringify(request)
  hmac.update(jsonString, 'utf8')
  const hmacOutput = hmac.digest()

  return hmacOutput
}

// base64url encoded without padding
function toCryptoConditionBase64 (normalBase64) {
  return normalBase64.replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function toConditionUri (conditionPreimage) {
  const hash = crypto.createHash('sha256')
  hash.update(conditionPreimage)
  const condition = hash.digest('base64')
  const conditionUri = 'cc:0:3:' + toCryptoConditionBase64(condition) + ':32'

  return conditionUri
}

function toFulfillmentUri (conditionPreimage) {
  const fulfillment = conditionPreimage.toString('base64')
  const fulfillmentUri = 'cf:0:' + toCryptoConditionBase64(fulfillment)
  return fulfillmentUri
}

exports.createReceiver = createReceiver
