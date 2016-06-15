'use strict'

const cc = require('five-bells-condition')
const crypto = require('crypto')
const BigNumber = require('bignumber.js')
const debug = require('debug')('ilp-payment-request')
const EventEmitter = require('eventemitter2')
const uuid = require('node-uuid')
const stringify = require('canonical-json')

const DEFAULT_TIMEOUT = 10000

/**
 * @module PaymentRequest
 */

/**
 * @class
 */
class PaymentRequest extends EventEmitter {
  /**
   * @typedef {Object} Params
   * @param {String} [id=(random UUID v4)] Unique request ID. MUST be unique because it is used to generate the condition
   * @param {String|Number|BigNumber} destinationAmount The amount to receive
   * @param {Number} [timeout=10000] Number of milliseconds to expire request after
   * @param {Object} [data] Additional data to include in the PaymentRequest (and the sender's corresponding payment). This can be used to add metadata for use when handling incoming payments
   * @param {Boolean} [unsafeOptimisticTransport=false] Don't use a condition to secure the payment, use the Optimistic Transport Protocol
   */

  /**
   * Instantiates a PaymentRequest
   * @param  {module:Client~Client} client ILP client used for quoting and paying
   * @param  {Params} params PaymentRequest parameters
   */
  constructor (client, params) {
    super()
    this.client = client
    if (typeof params !== 'object') {
      throw new Error('PaymentRequest must be instantiated with a client and params')
    }
    if (!params.destinationAmount) {
      throw new Error('destinationAmount is required')
    }
    if (!params.destinationAccount) {
      throw new Error('destinationAccount is required')
    }
    if (!params.destinationLedger) {
      throw new Error('destinationLedger is required')
    }

    this.id = params.id || uuid.v4()
    this.destinationAmount = (typeof params.destinationAmount !== 'string' ? new BigNumber(params.destinationAmount).toString() : params.destinationAmount)
    this.expiresAt = (typeof params.expiresAt !== 'string' ? (new Date(Date.now() + (params.timeout || DEFAULT_TIMEOUT))).toISOString() : params.expiresAt)
    this.data = params.data
    this.destinationLedger = params.destinationLedger
    this.destinationAccount = params.destinationAccount
    this.executionCondition = params.executionCondition // this will be generated if it is not set
    this.unsafeOptimisticTransport = (params.unsafeOptimisticTransport === true)
  }

  static fromPacket (client, packet) {
    if (!packet) {
      throw new Error('Must provide client and packet')
    }
    const params = {
      id: packet.data.id,
      destinationLedger: packet.ledger,
      destinationAccount: packet.account,
      destinationAmount: packet.amount,
      expiresAt: packet.data.expiresAt,
      data: packet.data.userData,
      executionCondition: packet.data.executionCondition,
      unsafeOptimisticTransport: !packet.data.executionCondition
    }

    return new PaymentRequest(client, params)
  }

  /**
   * Get the ILP packet to send to the sender.
   *
   * If unsafeOptimisticTransport is not set, this will deterministically generate a condition from the packet fields.
   * Note that it is **VERY IMPORTANT** that the PaymentRequest ID be unique, otherwise multiple requests will have the same condition.
   *
   * @return {Object}
   */
  getPacket () {
    let packet = this._getPacketWithoutCondition()

    if (!this.unsafeOptimisticTransport) {
      const conditionUri = this._generateCondition(packet).getConditionUri()
      debug('generated condition:', conditionUri, ' from packet:', packet)
      packet.data.executionCondition = conditionUri
    }

    return packet
  }

  /**
   * @private
   * Get the ILP packet without generating a condition.
   */
  _getPacketWithoutCondition () {
    let packet = {
      account: this.destinationAccount,
      ledger: this.destinationLedger,
      amount: this.destinationAmount,
      data: {
        id: this.id,
        expiresAt: this.expiresAt
      }
    }
    if (this.data) {
      packet.data.userData = this.data
    }
    return packet
  }

  /**
   * @private
   * Generate a five-bells-condition PREIMAGE-SHA-256 Condition from a JSON ILP packet.
   */
  _generateCondition (packet) {
    const hmac = crypto.createHmac('sha256', this.client.conditionHashlockSeed)
    const jsonString = stringify(packet)
    hmac.update(jsonString)
    const hmacOutput = hmac.digest()

    const condition = new cc.PreimageSha256()
    condition.setPreimage(hmacOutput)
    return condition
  }

  /**
   * Get a quote for how much it would cost to pay for this payment request
   * @return {module:Client~QuoteResponse}
   */
  quote () {
    return this.client.quote({
      destinationAccount: this.destinationAccount,
      destinationLedger: this.destinationLedger,
      destinationAmount: this.destinationAmount,
      executionCondition: this.executionCondition,
      expiresAt: this.expiresAt
    })
  }

  /**
   * Pay for the payment request
   * @param  {String|Number|BigNumber} params.maxSourceAmount Maximum amount to send
   * @param {Number} [params.maxSourceHoldDuration=client.maxSourceHoldDuration] Maximum time (in seconds) the client will allow the source funds to be held for
   * @param {Boolean} [params.allowUnsafeOptimisticTransport=false] If false, do not send Optimistic payments, even if they are requested (because they may be lost in transit)
   * @return {Promise<Object>} Resolves when the payment has been sent
   */
  pay (params) {
    if (!params || !params.maxSourceAmount) {
      throw new Error('maxSourceAmount is required')
    }
    return this.client.send({
      maxSourceAmount: params.maxSourceAmount,
      maxSourceHoldDuration: params.maxSourceHoldDuration || this.client.maxSourceHoldDuration,
      unsafeOptimisticTransport: (params.allowUnsafeOptimisticTransport && !this.executionCondition),
      destinationAccount: this.destinationAccount,
      destinationLedger: this.destinationLedger,
      destinationAmount: this.destinationAmount,
      executionCondition: this.executionCondition,
      expiresAt: this.expiresAt
    })
  }
}

module.exports = PaymentRequest
