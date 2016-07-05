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
 * @typedef {Object} PaymentRequestJson
 * @param {String} [id=(random UUID v4)] Unique request ID. MUST be unique because it is used to generate the condition
 * @param {String|Number|BigNumber} destinationAmount The amount to receive
 * @param {String} destinationLedger Receiver's ledger
 * @param {String} destinationAccount Receiver's account
 * @param {String} [expiresAt=(never)] Timestamp when request expires and will no longer be fulfilled by the recipient
 * @param {Object} [destinationMemo] Additional data to include in the PaymentRequest (and the sender's corresponding payment). This can be used to add metadata for use when handling incoming payments
 * @param {String} [executionCondition] Request condition. Required but may be set after instantiation
 */

/**
 * @class
 */
class PaymentRequest {
  /**
   * Instantiates a PaymentRequest
   * @param {PaymentRequestJson} params
   */
  constructor (params) {
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
    this.destinationLedger = params.destinationLedger
    this.destinationAccount = params.destinationAccount
    // Optional params
    this.expiresAt = params.expiresAt
    this.destinationMemo = params.destinationMemo
    this.executionCondition = params.executionCondition
  }

  /**
   * Parse PaymentRequest from JSON serialization
   * @param  {PaymentRequestJson} json
   * @return {PaymentRequest}
   */
  static fromJSON (json) {
    return new PaymentRequest(json)
  }

  /**
   * Parse PaymentRequest from a [Transfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#class-transfer)
   * @param  {Transfer} [Transfer](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#class-transfer)
   * @param  {String} additionalParams.ledger Destination ledger
   * @param  {String} additionalParams.account Destination account
   * @return {PaymentRequest}
   */
  static fromTransfer (transfer, additionalParams) {
    const params = {
      id: transfer.data.id,
      destinationAmount: transfer.amount,
      expiresAt: transfer.data.expiresAt,
      destinationMemo: transfer.data.destinationMemo,
      executionCondition: transfer.executionCondition,
      // Supplied in additionalParams:
      destinationLedger: additionalParams.ledger,
      destinationAccount: additionalParams.account
    }

    return new PaymentRequest(params)
  }

  /**
   * Get the JSON representation of the PaymentRequest to send to the sender.
   * @return {PaymentRequestJson}
   */
  toJSON () {
    if (!this.executionCondition) {
      throw new Error('PaymentRequests must have executionConditions')
    }

    return {
      id: this.id,
      destinationAmount: this.destinationAmount,
      destinationLedger: this.destinationLedger,
      destinationAccount: this.destinationAccount,
      expiresAt: this.expiresAt,
      destinationMemo: this.destinationMemo,
      executionCondition: this.executionCondition
    }
  }

  /**
   * @private
   */
  _getDataField () {
    return {
      id: this.id,
      destinationMemo: this.destinationMemo,
      expiresAt: this.expiresAt
    }
  }

  /**
   * Set the request condition
   * @param {String} conditionUri String serialized condition URI
   */
  setCondition (conditionUri) {
    this.executionCondition = conditionUri
  }

  /**
   * Generate a five-bells-condition PREIMAGE-SHA-256 Condition
   * @param {Buffer} conditionHashlockSeed Key for the HMAC used to create the fulfillment
   * @return {Condition} [five-bells-condition](https://github.com/interledger/five-bells-condition)
   */
  generateHashlockCondition (conditionHashlockSeed) {
    const hmac = crypto.createHmac('sha256', conditionHashlockSeed)
    const jsonString = stringify({
      id: this.id,
      destinationAmount: this.destinationAmount,
      destinationLedger: this.destinationLedger,
      destinationAccount: this.destinationAccount,
      expiresAt: this.expiresAt,
      destinationMemo: this.destinationMemo
    })
    hmac.update(jsonString, 'utf8')
    const hmacOutput = hmac.digest()

    const condition = new cc.PreimageSha256()
    condition.setPreimage(hmacOutput)
    return condition
  }
}

exports.PaymentRequest = PaymentRequest
