'use strict'

const uuid = require('uuid')
const moment = require('moment')
const Client = require('ilp-core').Client
const EventEmitter = require('eventemitter2')
const base64url = require('../utils/base64url')
const cc = require('../utils/condition')
const debug = require('debug')('ilp:receiver')
const BigNumber = require('bignumber.js')
const cryptoHelper = require('../utils/crypto')
const util = require('util')
const packet = require('ilp-packet')

const IPR_RECEIVER_ID_PREFIX = '~ipr.'
const PSK_RECEIVER_ID_PREFIX = '~psk.'

/**
 * @module Receiver
 */

/**
 * @callback reviewPaymentCallback
 * @param {PaymentRequest} payment payment request object
 * @param {Transfer} transfer transfer object for the payment being reviewed
 * @return {Promise.<null>|null} cancels the payment if it rejects/throws an error.
 */

/**
 * @typedef {Object} PskParams
 * @property {string} destinationAccount Receiver's ILP address
 * @property {string} sharedSecret Base64Url-encoded shared secret
 */

/**
 * Returns an ILP Receiver to create payment requests,
 * listen for incoming transfers, and automatically fulfill conditions
 * of transfers paying for the payment requests created by the Receiver.
 *
 * @param  {LedgerPlugin} opts._plugin Ledger plugin used to connect to the ledger, passed to [ilp-core](https://github.com/interledgerjs/ilp-core)
 * @param  {Object}  opts Plugin parameters, passed to [ilp-core](https://github.com/interledgerjs/ilp-core)
 * @param  {ilp-core.Client} [opts.client=create a new instance with the plugin and opts] [ilp-core](https://github.com/interledgerjs/ilp-core) Client, which can optionally be supplied instead of the previous options
 * @param  {Buffer} [opts.hmacKey=crypto.randomBytes(32)] 32-byte secret used for generating request conditions
 * @param  {Number} [opts.defaultRequestTimeout=30] Default time in seconds that requests will be valid for
 * @param  {Boolean} [opts.allowOverPayment=false] Allow transfers where the amount is greater than requested
 * @param {String} [opts.roundingMode=null] Round request amounts with too many decimal places, possible values are "UP", "DOWN", "HALF_UP", "HALF_DOWN" as described in https://mikemcl.github.io/bignumber.js/#constructor-properties
 * @param  {Number} [opts.connectionTimeout=10] Time in seconds to wait for the ledger to connect
 * @param  {reviewPaymentCallback} [opts.reviewPayment] called before fulfilling any incoming payments. The receiver doesn't fulfill the payment if reviewPayment rejects. PSK will not be used if reviewPayment is not provided.
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
  const hmacHelper = cryptoHelper.createHmacHelper(opts.hmacKey)
  const receiverIdBuffer = hmacHelper.getReceiverId()
  const receiverId = base64url(receiverIdBuffer)
  const iprReceiverId = IPR_RECEIVER_ID_PREFIX + receiverId + '.'
  const pskReceiverId = PSK_RECEIVER_ID_PREFIX + receiverId + '.'
  debug('receiver id: ' + receiverId)

  const reviewPayment = opts.reviewPayment
  const defaultRequestTimeout = opts.defaultRequestTimeout || 30
  const allowOverPayment = !!opts.allowOverPayment
  const connectionTimeout = opts.connectionTimeout || 10
  const roundingMode = opts.roundingMode && opts.roundingMode.toUpperCase()
  if (roundingMode && !BigNumber.hasOwnProperty('ROUND_' + roundingMode)) {
    throw new Error('invalid roundingMode: ' + opts.roundingMode)
  }
  // the following details are set on listen
  let account
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
   * @private
   *
   * Round the amount based on the rounding mode specified.
   * Throws errors if rounding the amount would increase or decrease it too much.
   */
  function roundAmount (amount, roundDirection) {
    if (!roundDirection) {
      return amount
    }
    const roundingMode = 'ROUND_' + roundDirection.toUpperCase()
    if (!BigNumber.hasOwnProperty(roundingMode)) {
      throw new Error('invalid roundingMode: ' + roundDirection)
    }
    const roundedAmount = amount.round(0, BigNumber[roundingMode])
    debug('rounded amount ' + amount.toString() + ' ' + roundDirection + ' to ' + roundedAmount.toString())

    if (roundedAmount.equals(0)) {
      throw new Error('rounding ' + amount.toString() + ' ' + roundDirection + ' would reduce it to zero')
    }

    if (amount.times(2).lessThan(roundedAmount)) {
      throw new Error('rounding ' + amount.toString() + ' ' + roundDirection + ' would more than double it')
    }

    return roundedAmount
  }

  /**
   * Create a payment request
   *
   * @param  {String} params.amount Amount to request. It will throw an error if the amount has too many decimal places or significant digits, unless the receiver option roundRequestsAmounts is set
   * @param  {String} [params.account=client.getAccount()] Optionally specify an account other than the one the receiver would get from the connected plugin
   * @param  {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
   * @param  {String} [params.expiresAt=30 seconds from now] Expiry of request
   * @param  {Object} [params.data=null] Additional data to include in the request
   * @param {String} [params.roundingMode=receiver.roundingMode] Round request amounts with too many decimal places, possible values are "UP", "DOWN", "HALF_UP", "HALF_DOWN" as described in https://mikemcl.github.io/bignumber.js/#constructor-properties
   * @return {Object}
   */
  function createRequest (params) {
    debug('creating request with params:', params)
    if (!client.getPlugin().isConnected()) {
      throw new Error('receiver must be connected to create requests')
    }

    if (!params.amount) {
      throw new Error('amount is required')
    }

    const amount = roundAmount(
      new BigNumber(params.amount),
      params.roundingMode || roundingMode
    )
    if (amount.decimalPlaces() > 0) {
      throw new Error('request amount must be an integer')
    }
    if (amount.precision() > precision) {
      throw new Error('request amount has more significant digits than the ledger supports (' + precision + ')')
    }

    if (params.expiresAt && !moment(params.expiresAt, moment.ISO_8601).isValid()) {
      throw new Error('expiresAt must be an ISO 8601 timestamp')
    }

    const requestAddress = (params.account || account) + '.' + iprReceiverId + (params.id || uuid.v4())

    const paymentRequest = {
      address: requestAddress,
      amount: amount.toString(),
      expires_at: params.expiresAt || moment().add(defaultRequestTimeout, 'seconds').toISOString()
    }

    if (params.data) {
      paymentRequest.data = params.data
    }

    const conditionPreimage = hmacHelper.hmacJsonForIprCondition(paymentRequest)
    paymentRequest.condition = cc.toConditionUri(conditionPreimage)

    debug('created payment request:', paymentRequest)
    return paymentRequest
  }

  /**
   * Generate shared secret for Pre-Shared Key (PSK) transport protocol.
   *
   * @return {PskParams}
   */
  function generatePskParams () {
    const token = base64url(hmacHelper.getPskToken())
    return {
      destinationAccount: getAddress() + '.' + pskReceiverId + token,
      sharedSecret: base64url(hmacHelper.getPskSharedSecret(token))
    }
  }

  /**
   * @private
   * @param {String} transferId
   * @param {RejectionMessage} rejectionMessage
   * @returns {Promise<RejectionMessage>} the rejection message
   */
  function rejectIncomingTransfer (transferId, rejectionMessage) {
    return client.getPlugin()
      .rejectIncomingTransfer(transferId, Object.assign({
        triggered_by: account,
        triggered_at: (new Date()).toISOString(),
        additional_info: {}
      }, rejectionMessage))
      .then(() => rejectionMessage)
  }

  /**
   * @private
   *
   * When we receive a transfer notification, check the transfer
   * and try to fulfill the condition (which will only work if
   * it corresponds to a request or shared secret we created)
   * Calls the `reviewPayment` callback before fulfillingthe.
   *
   * Note return values are only for testing
   */
  function autoFulfillCondition (transfer) {
    if (transfer.cancellationCondition) {
      debug('got notification of transfer with cancellationCondition', transfer)
      return rejectIncomingTransfer(transfer.id, {
        code: 'S00',
        name: 'Bad Request',
        message: 'got notification of transfer with cancellationCondition'
      })
    }

    if (!transfer.executionCondition) {
      debug('got notification of transfer without executionCondition ', transfer)
      return rejectIncomingTransfer(transfer.id, {
        code: 'S00',
        name: 'Bad Request',
        message: 'got notification of transfer without executionCondition'
      })
    }

    if (!transfer.ilp) {
      debug('got notification of transfer with no packet attached')
      return rejectIncomingTransfer(transfer.id, {
        code: 'S01',
        name: 'Invalid Packet',
        message: 'got notification of transfer with no packet attached'
      })
    }

    // The payment request is extracted from the ILP packet
    let jsonPacket
    try {
      jsonPacket = packet.deserializeIlpPayment(Buffer.from(transfer.ilp, 'base64'))
    } catch (err) {
      return rejectIncomingTransfer(transfer.id, {
        code: 'S01',
        name: 'Invalid Packet',
        message: 'got notification of transfer with invalid ILP packet'
      })
    }

    // check if the address starts with our address
    if (jsonPacket.account.indexOf(getAddress()) !== 0) {
      debug('got notification of transfer for another account account=' + jsonPacket.account + ' me=' + getAddress())
      return 'not-my-packet'
    }

    // check if the address contains "~ipr"/"~psk" + our receiver id
    const localPart = jsonPacket.account.slice(getAddress().length + 1)
    let protocol = null
    let requestId = null
    let sharedSecret = null
    if (localPart.indexOf(iprReceiverId) === 0) {
      protocol = 'ipr'
      requestId = localPart.slice(iprReceiverId.length)
    } else if (localPart.indexOf(pskReceiverId) === 0) {
      protocol = 'psk'
      requestId = localPart.slice(pskReceiverId.length).split('.', 1)[0]
      sharedSecret = hmacHelper.getPskSharedSecret(requestId)
    } else {
      debug('got notification of transfer for another receiver local_part=' + localPart + ' me=' + receiverId)
      return 'not-my-packet'
    }

    if (!jsonPacket.amount) {
      debug('got notification of transfer with packet that has no amount')
      return rejectIncomingTransfer(transfer.id, {
        code: 'S01',
        name: 'Invalid Packet',
        message: 'got notification of transfer with packet that has no amount'
      })
    }

    let packetData
    try {
      packetData = jsonPacket.data ? JSON.parse(Buffer.from(jsonPacket.data, 'base64')) : {}
    } catch (err) {
      return rejectIncomingTransfer(transfer.id, {
        code: 'S01',
        name: 'Invalid Packet',
        message: 'packet.data parse error: ' + err.message
      })
    }

    const paymentRequest = {
      address: jsonPacket.account,
      amount: jsonPacket.amount,
      expires_at: packetData.expires_at
    }

    if (packetData.data) {
      paymentRequest.data = packetData.data
    }

    debug('parsed payment request from transfer:', paymentRequest)

    if ((new BigNumber(transfer.amount)).lessThan(jsonPacket.amount)) {
      debug('got notification of transfer where amount is less than expected (' + jsonPacket.amount + ')', transfer)
      return rejectIncomingTransfer(transfer.id, {
        code: 'S04',
        name: 'Insufficient Destination Amount',
        message: 'got notification of transfer where amount is less than expected'
      })
    }

    if (!allowOverPayment && (new BigNumber(transfer.amount)).greaterThan(jsonPacket.amount)) {
      debug('got notification of transfer where amount is greater than expected (' + jsonPacket.amount + ')', transfer)
      return rejectIncomingTransfer(transfer.id, {
        code: 'S03',
        name: 'Invalid Amount',
        message: 'got notification of transfer where amount is greater than expected'
      })
    }

    if (paymentRequest.expires_at && moment().isAfter(paymentRequest.expires_at)) {
      debug('got notification of transfer with expired packet', transfer)
      return rejectIncomingTransfer(transfer.id, {
        code: 'R01',
        name: 'Transfer Timed Out',
        message: 'got notification of transfer with expired packet'
      })
    }

    if (protocol === 'psk' && !reviewPayment) {
      debug('got PSK payment on non-PSK receiver')
      return rejectIncomingTransfer(transfer.id, {
        code: 'S00',
        name: 'Bad Request',
        message: 'got PSK payment on non-PSK receiver'
      })
    }

    let conditionPreimage
    if (protocol === 'ipr') {
      conditionPreimage = hmacHelper.hmacJsonForIprCondition(paymentRequest)
    } else if (protocol === 'psk') {
      conditionPreimage = cryptoHelper.hmacJsonForPskCondition(paymentRequest, sharedSecret)
    }

    if (transfer.executionCondition !== cc.toConditionUri(conditionPreimage)) {
      debug('got notification of transfer where executionCondition does not match the one we generate (' + cc.toConditionUri(conditionPreimage) + ')', transfer)
      // Do not reject the incoming transfer here because it may have been created
      // by another receiver with a different hmacKey listening on the same account
      return 'condition-mismatch'
    }

    // Decrypt the memo before submitting it for review
    // Note we only decrypt the memo after regenerating the fulfillment
    // because the sender should encrypt-then-MAC
    if (protocol === 'psk' && paymentRequest.data) {
      if (Object.keys(paymentRequest.data).length > 1 || !paymentRequest.data.blob) {
        debug('got PSK payment where the data is not encrypted', paymentRequest)
        return rejectIncomingTransfer(transfer.id, {
          code: 'S00',
          name: 'Bad Request',
          message: 'got PSK payment where the data is not encrypted'
        })
      }
      try {
        paymentRequest.data = cryptoHelper.aesDecryptObject(
          Buffer.from(paymentRequest.data.blob, 'base64'),
          sharedSecret)
        debug('decrypted payment request data:', paymentRequest.data)
      } catch (e) {
        // return errors as promises, in case of invalid data
        debug('got corrupted data', e, paymentRequest.data)
        return rejectIncomingTransfer(transfer.id, {
          code: 'S00',
          name: 'Bad Request',
          message: 'got corrupted data'
        })
      }
    }

    const fulfillment = cc.toFulfillmentUri(conditionPreimage)
    // reviewPromise will resolve to null if we should go ahead and
    // to the rejection message if the payment has been rejected
    const reviewPromise = Promise.resolve()
      .then(() => {
        if (typeof reviewPayment === 'function') {
          return reviewPayment(transfer, paymentRequest)
        } else {
          return null
        }
      })
      .then(() => null)
      .catch((err) => {
        debug('reviewPayment got error', err)
        let errorMessage
        if (err instanceof Error) {
          errorMessage = err.name + ': ' + err.message
        } else if (typeof err === 'string') {
          errorMessage = err
        } else {
          errorMessage = 'reason not specified'
        }
        return rejectIncomingTransfer(transfer.id, {
          code: 'S00',
          name: 'Bad Request',
          message: 'rejected-by-receiver: ' + errorMessage
        })
      })

    // returning the promise is only so the result is picked up by the tests' emitAsync
    return reviewPromise
      .then((rejectionMessage) => {
        if (rejectionMessage) {
          return rejectionMessage
        }

        debug('about to submit fulfillment: ' + fulfillment)
        return client.fulfillCondition(transfer.id, fulfillment)
          .then(() => {
            debug('successfully submitted fulfillment ' + fulfillment + ' for request ' + requestId + ' (transfer ' + transfer.id + ')')

            /**
            * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string
            *
            * @event incoming
            * @type {object}
            */
            eventEmitter.emit('incoming', transfer, fulfillment, paymentRequest)

            if (protocol === 'ipr') {
              /**
              * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string for a specific request
              *
              * @event incoming:ipr:<requestid>
              * @type {object}
              */
              // Allow listeners for specific requests and on wildcard events such that
              // `incoming:appid.*` will match `incoming:appid:requestid`
              eventEmitter.emit('incoming:ipr:' + requestId, transfer, fulfillment, paymentRequest)

              // alternate return this promise in order to deprecate event
              return eventEmitter.emitAsync('incoming:' + requestId, transfer, fulfillment, paymentRequest).then((res) => {
                if (res.length) util.deprecate(() => {}, 'listen to "incoming:ipr:" instead of "incoming"')
                return 'sent'
              })
            } else if (protocol === 'psk') {
              /**
              * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string for a specific token
              *
              * @event incoming:psk:<token>
              * @type {object}
              */
              eventEmitter.emit('incoming:psk:' + requestId, transfer, fulfillment, paymentRequest)
            }

            return 'sent'
          })
          .catch((err) => {
            debug('error submitting fulfillment', err)
          })
      })
  }

  /**
   * Listen for incoming transfers and automatically fulfill
   * conditions for transfers corresponding to requests this
   * receiver created.
   *
   * @fires incoming
   * @fires incoming:<requestid>
   * @fires incoming:psk:<token>
   *
   * @return {Promise.<null>} Resolves when the receiver is connected
   */
  function listen () {
    // don't have multiple listeners even if listen is called more than once
    client.removeListener('incoming_prepare', autoFulfillCondition)
    client.on('incoming_prepare', autoFulfillCondition)
    return Promise.race([
      client.connect()
        .then(() => {
          account = client.getPlugin().getAccount()
          const info = client.getPlugin().getInfo()
          debug('account: ' + account + ' ledger info: ', info)
          precision = info.precision
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
    client.removeListener('incoming_prepare', autoFulfillCondition)
    return client.disconnect()
  }

  return Object.assign(eventEmitter, {
    getAddress,
    createRequest,
    generatePskParams,
    listen,
    stopListening
  })
}

exports.createReceiver = createReceiver
