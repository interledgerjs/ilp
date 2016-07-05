'use strict'

const crypto = require('crypto')
const BigNumber = require('bignumber.js')
const debug = require('debug')('ilp-client')
const EventEmitter = require('eventemitter2')
const CoreClient = require('ilp-core').Client
const PaymentRequest = require('./request').PaymentRequest

/**
 * @module Client
 */

/**
 * Low-level client for sending and receiving ILP payments (extends [Core Client](https://github.com/interledger/js-ilp-core))
 * @class
 */
class Client extends CoreClient {
  /**
   * Instantiates an ILP client
   * @param {String} [opts.type='bells'] Ledger type to connect to, defaults to 'five-bells'
   * @param {Object} opts.auth Auth parameters for connecting to the ledger. Fields are defined by the ledger plugin corresponding to the ledgerType`
   * @param {Buffer} [opts.conditionHashlockSeed=crypto.randomBytes(32)] Seed to use for generating the hashlock conditions
   */
  constructor (opts) {
    // Default to `five-bells-ledger`
    if (!opts.type) {
      opts.type = 'bells'
    }

    super(opts)
    if (Buffer.isBuffer(opts.conditionHashlockSeed)) {
      this.conditionHashlockSeed = opts.conditionHashlockSeed
    } else if (!opts.conditionHashlockSeed) {
      this.conditionHashlockSeed = crypto.randomBytes(32)
    } else {
      throw new Error('conditionHashlockSeed must be a Buffer')
    }
    this.on('receive', (transfer) => this._tryAutoFulfillPaymentRequest(transfer))
    this.on('fulfill_execution_condition', (transfer, fulfillment) => this._handleFulfillment(transfer, fulfillment))

    this._account = this.plugin.getAccount()
    this._ledger = this.plugin.id

    this._fulfillmentsToListenFor = {}
  }

  connect () {
    super.connect()
    return super.waitForConnection()
      .then(() => {
        // TODO should ledger plugins have this before they're connected?
        if (!this._ledger) {
          this._ledger = this.plugin.id
        }
      })
  }

  /**
   * Get a quote
   * @param  {String} [params.sourceAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} [params.destinationAmount] Either the sourceAmount or destinationAmount must be specified
   * @param  {String} params.destinationLedger Recipient's ledger
   * @return {Object} Object including the amount that was not specified
   */
  quote (params) {
    return super.quote(params)
  }

  /**
   * Send a payment
   * @param  {String} params.sourceAmount Amount to send
   * @param  {String} params.destinationAmount Amount recipient will receive
   * @param  {String} params.destinationAccount Recipient's account
   * @param  {String} params.destinationLedger Recipient's ledger
   * @param  {String} params.connectorAccount First connector's account on the source ledger (from the quote)
   * @param  {Object} params.destinationMemo Memo for the recipient to be included with the payment
   * @param  {String} params.expiresAt Payment expiry timestamp
   * @param  {String} [params.executionCondition=Error unless unsafeOptimisticTransport is true] Crypto condition
   * @param  {Boolean} [params.unsafeOptimisticTransport=false] Send payment without securing it with a condition
   * @return {Promise.<null>} Resolves when the payment has been submitted to the plugin
   */
  sendQuotedPayment (params) {
    return super.sendQuotedPayment(params)
  }

  /**
   * Create a PaymentRequest.
   *
   * If the request is serialized, sent to the sender,
   * and the sender pays for the request, the receiving client
   * will automatically fulfill the condition iff the incoming transfer
   * matches what was specified in the original request.
   * 
   * @param {module:PaymentRequest~PaymentRequestJson} params Parameters to create the PaymentRequest
   * @return {module:PaymentRequest~PaymentRequest}
   */
  createRequest (params) {
    const paymentRequest = new PaymentRequest(Object.assign({}, params, {
      destinationAccount: this._account,
      destinationLedger: this._ledger
    }))

    // Auto-generate the condition
    if (!params.executionCondition && !params.unsafeOptimisticTransport) {
      const condition = paymentRequest.generateHashlockCondition(this.conditionHashlockSeed)
      paymentRequest.setCondition(condition.getConditionUri())
    }

    return paymentRequest
  }

  /**
   * Parse a payment request from a serialized form
   * @param  {PaymentRequestJson} input
   * @return {PaymentRequest}
   */
  parseRequest (input) {
    return PaymentRequest.fromJSON(input)
  }

  /**
   * Get a quote for how much it would cost to pay for this payment request
   * @param {PaymentRequest} paymentRequest Parsed PaymentRequest
   * @return {module:Client~QuoteResponse}
   */
  quoteRequest (paymentRequest) {
    return this.quote({
      destinationAccount: paymentRequest.destinationAccount,
      destinationLedger: paymentRequest.destinationLedger,
      destinationAmount: paymentRequest.destinationAmount,
      executionCondition: paymentRequest.executionCondition,
      expiresAt: paymentRequest.expiresAt
    })
  }

  /**
   * Pay for a PaymentRequest
   * @param {PaymentRequest} paymentRequest Request to pay for
   * @param {String|Number|BigNumber} params.sourceAmount Amount to send. Should be determined from quote
   * @return {Promise<null>} Resolves when the payment has been sent
   */
  payRequest (paymentRequest, params) {
    if (!paymentRequest || !params.sourceAmount) {
      return Promise.reject(new Error('sourceAmount is required'))
    }

    if (!paymentRequest.executionCondition) {
      return Promise.reject(new Error('PaymentRequests must have executionConditions'))
    }

    // TODO local expiresAt should be less than the packet's expiry

    return this.sendQuotedPayment({
      sourceAmount: params.sourceAmount,
      connectorAccount: params.connectorAccount,
      unsafeOptimisticTransport: false,
      destinationAccount: paymentRequest.destinationAccount,
      destinationLedger: paymentRequest.destinationLedger,
      destinationAmount: paymentRequest.destinationAmount,
      destinationMemo: paymentRequest._getDataField(),
      executionCondition: paymentRequest.executionCondition,
      expiresAt: paymentRequest.expiresAt
    })

    // TODO resolve when we get the fulfillment back
  }

  /**
   * @private
   * Automatically fulfill transfers that were PaymentRequests we generated
   */
  _tryAutoFulfillPaymentRequest (transfer) {
    debug('got notification of transfer', transfer)
    // Disregard outgoing transfers
    if (transfer.direction !== 'incoming') {
      debug('got notification of outgoing transfer:', JSON.stringify(transfer))
      return
    }
    // Disregard transfers with cancellationConditions
    if (transfer.cancellationCondition) {
      debug('got notification of transfer with cancellationCondition:', JSON.stringify(transfer))
      return
    }

    if (!transfer.executionCondition) {
      debug('got notification of transfer without an executionCondition')
      return
    }

    let parsedRequest
    try {
      parsedRequest = this._parseRequestFromTransfer(transfer)
    } catch (e) {
      debug('failed to parse payment request from transfer:', e)
      return
    }

    // Check request expiry
    if (parsedRequest.expiresAt) {
      const expiresAt = Date.parse(parsedRequest.expiresAt)
      if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
        debug('got incoming transfer with invalid or passed expiry:', JSON.stringify(transfer))
        return
      }
    }

    // Regenerate the condition
    // Note the condition will not match if any of the fields do not match what we set originally
    const generatedCondition = parsedRequest.generateHashlockCondition(this.conditionHashlockSeed)
    if (generatedCondition.getConditionUri() !== transfer.executionCondition) {
      debug('got incoming transfer where the condition (' + transfer.executionCondition + ') does not match what we generate (' + generatedCondition.getConditionUri() + '):', JSON.stringify(transfer))
      return
    }

    // Submit the fulfillment to the ledger
    const fulfillment = generatedCondition.serializeUri()
    this._fulfillmentsToListenFor[transfer.id] = fulfillment
    this.fulfillCondition(transfer.id, fulfillment)
      .then(() => {
        debug('submitted transfer fulfillment: ' + fulfillment + ' for transfer:', JSON.stringify(transfer))
      })
      .catch((err) => {
        debug('error submitting fulfillment:', err)
        this.emit('error', err)
      })
  }

  /**
   * @private
   */
  _parseRequestFromTransfer (transfer) {
    return PaymentRequest.fromTransfer(transfer, {
      account: this._account,
      ledger: this._ledger
    })
  }

  /**
   * @private
   */
  _handleFulfillment (transfer, fulfillment) {
    if (transfer &&
        transfer.id &&
        this._fulfillmentsToListenFor[transfer.id] &&
        this._fulfillmentsToListenFor[transfer.id] === fulfillment) {
      this.emit('payment_request_paid', this._parseRequestFromTransfer(transfer), fulfillment)
      this._fulfillmentsToListenFor[transfer.id] = null
    }
  }
}

exports.Client = Client
