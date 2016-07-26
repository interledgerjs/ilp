'use strict'

const crypto = require('crypto')
const uuid = require('node-uuid')
const moment = require('moment')
const stringify = require('canonical-json')
const Client = require('ilp-core').Client
const cc = require('five-bells-condition')
const EventEmitter = require('eventemitter2')
const debug = require('debug')('ilp-itp:receiver')

/**
 * @module Receiver
 */

/**
 * Returns an ITP/ILP Receiver to create payment requests,
 * listen for incoming transfers, and automatically fulfill conditions
 * of transfers paying for the payment requests created by the Receiver.
 *
 * @param  {String} opts.ledgerType Type of ledger to connect to, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {Objct}  opts.auth Auth parameters for the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {Buffer} [opts.hmacKey=crypto.randomBytes(32)] 32-byte secret used for generating request conditions
 * @param  {Number} [opts.defaultRequestTimeout=30] Default time in seconds that requests will be valid for
 * @return {Receiver}
 */
function createReceiver (opts) {
  const client = opts._client || new Client({
    type: opts.ledgerType,
    auth: opts.auth
  })

  const eventEmitter = new EventEmitter()

  if (opts.hmacKey && (!Buffer.isBuffer(opts.hmacKey) || opts.hmacKey.length < 32)) {
    throw new Error('hmacKey must be 32-byte Buffer if supplied')
  }
  const hmacKey = opts.hmacKey || crypto.randomBytes(32)
  const defaultRequestTimeout = opts.defaultRequestTimeout || 30

  /**
   * Create a payment request
   *
   * @param  {String} params.amount Amount to request
   * @param  {String} [params.id=uuid.v4()] Unique ID for the request (used to ensure conditions are unique per request)
   * @param  {String} [params.expiresAt=30 seconds from now] Expiry of request
   * @return {Object}
   */
  function createRequest (params) {
    if (!params.amount) {
      throw new Error('amount is required')
    }

    if (params.expiresAt && !moment(params.expiresAt, moment.ISO_8601).isValid()) {
      throw new Error('expiresAt must be an ISO 8601 timestamp')
    }

    let request = {
      amount: String(params.amount),
      ledger: client.getPlugin().id,
      account: client.getPlugin().getAccount(),
      data: {
        expires_at: params.expiresAt || moment().add(defaultRequestTimeout, 'seconds').toISOString(),
        request_id: params.id || uuid.v4()
      }
    }

    const condition = generateCondition(hmacKey, request)
    request.data.execution_condition = condition.getConditionUri()

    return request
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
    if (transfer.direction !== 'incoming') {
      debug('got notification of outgoing transfer', transfer)
      return 'outgoing'
    }

    if (transfer.cancellationCondition) {
      debug('got notification of transfer with cancellationCondition', transfer)
      return 'cancellation'
    }

    if (!transfer.executionCondition) {
      debug('got notification of transfer without executionCondition ', transfer)
      return 'no-execution'
    }

    // TODO look for the request in transfer.data.ilp_header after https://github.com/interledger/five-bells-connector/pull/195 is merged
    // if (!transfer.data || !transfer.data.ilp_header) {
    //   debug('got notification of transfer without ilp packet', transfer)
    //   return false
    // }
    const request = {
      amount: String(transfer.amount),
      ledger: client.getPlugin().id,
      account: client.getPlugin().getAccount(),
      data: {
        expires_at: transfer.data.expires_at,
        request_id: transfer.data.request_id
      }
    }

    // TODO re-enable this when we aren't using the transfer's amount
    // TODO also allow receiver to disallow amounts greater than requested
    // if ((new BigNumber(transfer.amount)).lessThan(request.amount)) {
    //   debug('got notification of transfer where amount is less than expected (' + request.amount + ')', transfer)
    //   return 'insufficient'
    // }

    if (request.data.expires_at && moment().isAfter(request.data.expires_at)) {
      debug('got notification of transfer with expired request packet', transfer)
      return 'expired'
    }

    const condition = generateCondition(hmacKey, request)

    if (transfer.executionCondition !== condition.getConditionUri()) {
      debug('got notification of transfer where executionCondition does not match the one we generate (' + condition.getConditionUri() + ')', transfer)
      return 'condition-mismatch'
    }

    const fulfillment = condition.serializeUri()
    // returning the promise is only so the result is picked up by the tests' emitAsync
    return client.fulfillCondition(transfer.id, fulfillment)
      .then(() => {
        debug('successfully submitted fulfillment ' + fulfillment + ' for transfer ' + transfer.id)
        eventEmitter.emit('incoming', transfer, fulfillment)
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
   *
   * @return {Promise.<null>} Resolves when the receiver is connected
   */
  function listen () {
    /**
     * [IncomingTransfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer) from the ledger plugin and the fulfillment string
     *
     * @event incoming
     * @type {object}
     */

    // TODO add connection timeout
    // don't have multiple listeners even if listen is called more than once
    client.removeListener('receive', autoFulfillConditions)
    client.on('receive', autoFulfillConditions)
    return client.connect()
      .then(() => client.waitForConnection())
      .then(() => debug('receiver listening'))
  }

  return Object.assign(eventEmitter, {
    createRequest,
    listen
  })
}

// TODO remove dependency on five-bells-condition because we don't need the other types
function generateCondition (hmacKey, request) {
  const hmac = crypto.createHmac('sha256', hmacKey)
  const jsonString = stringify(request)
  hmac.update(jsonString, 'utf8')
  const hmacOutput = hmac.digest()

  const condition = new cc.PreimageSha256()
  condition.setPreimage(hmacOutput)

  debug('generateCondition ' + jsonString + ' --> ' + condition.getConditionUri())

  return condition
}

exports.createReceiver = createReceiver
