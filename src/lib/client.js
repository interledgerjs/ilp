'use strict'

const crypto = require('crypto')
const BigNumber = require('bignumber.js')
const debug = require('debug')('ilp-client')
const EventEmitter = require('eventemitter2')
const CoreClient = require('ilp-core').Client
const PaymentRequest = require('./request')

/**
 * @module Client
 */

/**
 * Low-level client for sending and receiving ILP payments
 * @class
 */
class Client extends EventEmitter {
  /**
   * Instantiates an ILP client
   * @param {String} [opts.ledgerType='five-bells'] Ledger type to connect to, defaults to 'five-bells'
   * @param {Object} opts.auth Auth parameters for connecting to the ledger. Fields are defined by the ledger plugin corresponding to the ledgerType`
   * @param {Number} [opts.maxSourceHoldDuration=10] Default maximum time (in seconds) the client will allow the source funds to be held for when sending a transfer
   * @param {Buffer} [opts.conditionHashlockSeed=crypto.randomBytes(32)] Seed to use for generating the hashlock conditions
   */
  constructor (opts) {
    super()
    this.maxSourceHoldDuration = (opts.maxSourceHoldDuration || 10)
    if (Buffer.isBuffer(opts.conditionHashlockSeed)) {
      this.conditionHashlockSeed = opts.conditionHashlockSeed
    } else if (!opts.conditionHashlockSeed) {
      this.conditionHashlockSeed = crypto.randomBytes(32)
    } else {
      throw new Error('conditionHashlockSeed must be a Buffer')
    }
    this.coreClient = new CoreClient({
      type: (opts.ledgerType === 'five-bells' || !opts.ledgerType ? 'bells' : opts.ledgerType),
      auth: opts.auth
    })
    this.isConnected = false
    // this.coreClient.on('connect', () => this.emit('connect'))
    // this.coreClient.on('disconnect', () => this.emit('disconnect'))
    this.coreClient.on('receive', this._handleIncoming.bind(this))
    // this.coreClient.on('fulfill_execution_condition', this._handleIncoming.bind(this))
  }

  connect () {
    this.coreClient.connect()
    return this.coreClient.waitForConnection()
      .then(() => {
        // If we weren't connected before, get the account and ledger
        if (!this.isConnected) {
          return Promise.all([
            this.getAccount().then((account) => this._account = account),
            this._getLedger().then((ledger) => this._ledger = ledger)
          ])
        }
      })
      .then(() => {
        this.isConnected = true
        debug('client connected')
      })
      .catch((err) => {
        this.isConnected = false
        debug('connection error', err)
        throw err
      })
  }

  /**
   * Returns the account URI
   * @return {String}
   */
  getAccount () {
    return this.coreClient.waitForConnection()
      .then(() => this.coreClient.getPlugin().getAccount())
  }

  /**
   * @private
   */
  _getLedger () {
    // This is only needed while the ILP packet includes the ledger.
    // It will be removed when the full ILP address scheme is implemented.
    return this.coreClient.waitForConnection()
      .then(() => this.coreClient.getPlugin().id)
  }

  /**
   * @typedef {Object} QuoteResponse
   * @param {String} sourceAmount
   * @param {String} destinationAmount
   */

  /**
   * Get a quote
   *
   * @param  {Object} params Payment params, see ilp-core docs
   * @return {QuoteResponse}
   */
  quote (params) {
    return this._quote(params)
      .then((quote) => {
        return {
          sourceAmount: quote.source_amount,
          destinationAmount: quote.destination_amount
        }
      })
  }

  /**
   * @private
   */
  _quote (params) {
    return this.coreClient.waitForConnection()
      .then(() => {
        const payment = this.coreClient.createPayment(params)
        return payment.quote()
          .then((quote) => {
            debug('got quote:', quote)
            return quote
          })
      })
  }

  /**
   * Send an ILP payment
   * @param  {Object} params Payment params, see ilp-core docs
   * @param  {String|Number|BigNumber} params.maxSourceAmount Reject if the quoted source amount exceeds this value
   * @param {Number} [params.maxSourceHoldDuration=client.maxSourceHoldDuration] Maximum time (in seconds) the client will allow the source funds to be held for
   * @param {Boolean} [params.unsafeOptimisticTransport=false] Allow sending without a condition using the Optimistic transport
   * @return {Promise<Object>} Resolves when the payment has been sent
   */
  send (params) {
    let maxSourceAmount
    try {
      maxSourceAmount = new BigNumber(params.maxSourceAmount)
    } catch (e) {
      throw new Error('maxSourceAmount is required')
    }

    if (!params.executionCondition && !params.unsafeOptimisticTransport) {
      throw new Error('executionCondition is required unless unsafeOptimisticTransport is set to true')
    }

    debug('send:', params)
    const payment = this.coreClient.createPayment(params)
    return payment.quote()
      .then((quote) => {
        debug('send got quote:', quote)

        // Check quoted amount
        if (maxSourceAmount.lessThan(quote.source_amount)) {
          throw new Error('Transfer source amount (' + quote.source_amount + ') would exceed maxSourceAmount (' + maxSourceAmount.toString() + ')')
        }

        // Check quoted source hold duration
        const maxSourceHoldDuration = params.maxSourceHoldDuration || this.maxSourceHoldDuration
        if ((new BigNumber(quote.source_expiry_duration)).greaterThan(maxSourceHoldDuration)) {
          throw new Error('Source transfer hold duration (' + quote.source_expiry_duration + ') would exceed maxSourceHoldDuration (' + maxSourceHoldDuration + ')')
        }

        return payment.sendQuoted(quote)
      })
      .then((result) => {
        debug('send result:', result)
        return result
      })
      .catch((err) => {
        debug('send error:', err)
        throw err
      })
  }

  /**
   * Create a PaymentRequest. This is used on the receiving side.
   * @param {module:PaymentRequest~Params} params Parameters to create the PaymentRequest
   * @return {module:PaymentRequest~PaymentRequest}
   */
  createRequest (params) {
    if (!this.isConnected) {
      throw new Error('Client must be connected before it can create a PaymentRequest')
    }

    return new PaymentRequest(this, Object.assign({}, params, {
      destinationAccount: this._account,
      destinationLedger: this._ledger
    }))
  }

  /**
   * Parse a PaymentRequest from an ILP packet. This is used on the sending side.
   * @param  {Object} packet [ILP Packet]{@link https://github.com/interledger/five-bells-shared/blob/master/schemas/IlpHeader.json}
   * @return {module:PaymentRequest#PaymentRequest}
   */
  parseRequest (packet) {
    return PaymentRequest.fromPacket(this, packet)
  }

  /**
   * Automatically fulfill incoming requests that have conditions and emit events when money is received
   * @private
   * @param  {Transfer} transfer [Incoming transfer]{@link https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#incomingtransfer}
   * @param {String} fulfillment Transfer condition fulfillment
   */
  _handleIncoming (transfer, fulfillment) {
    if (transfer.direction !== 'incoming') {
      debug('got notification of outgoing transfer:', transfer, fulfillment)
      return
    }
    if (!transfer.executionCondition && !transfer.cancellationCondition) {
      this.emit('incoming', transfer)
      return
    }

    // TODO validate fulfillment and emit events accordingly

    if (!transfer.data || !transfer.data.ilp_header) {
      debug('got incoming transfer with no ilp_header in the data field:', transfer)
      this.emit('error', new Error('Received incoming transfer with a condition but no ilp_header in the data field (' + JSON.stringify(transfer.data) + ')'))
      return
    }
    let packet = transfer.data.ilp_header

    // Check packet against incoming transfer

    // Check amount
    // TODO: add option to allow amounts that are greater than the requested one
    if (!(new BigNumber(transfer.amount).equals(packet.amount))) {
      debug('got incoming transfer where the amount (' + transfer.amount + ') does not match the packet amount (' + packet.amount + ')')
      this.emit('error', new Error('Received incoming transfer where the amount (' + transfer.amount + ') does not match the packet amount (' + packet.amount + ')'))
      return
    }

    // Check condition
    const packetCondition = packet.data.executionCondition
    if (packetCondition && transfer.executionCondition !== packetCondition) {
      debug('got incoming transfer where the condition (' + transfer.executionCondition + ') does not match the packet condition (' + packetCondition + ')')
      this.emit('error', new Error('Received incoming transfer where the condition (' + transfer.executionCondition + ') does not match the packet condition (' + packetCondition + ')'))
      return
    }
    // Get the condition from the transfer if there isn't one in the packet
    if (!packetCondition) {
      packet.data.executionCondition = transfer.executionCondition
    }

    // Check expiry
    if (packet.data.expiresAt) {
      const expiresAt = Date.parse(packet.data.expiresAt)
      if (Number.isNaN(expiresAt)) {
        debug('got incoming transfer with invalid expiresAt (' + packet.data.expiresAt + ')')
        this.emit('error', new Error('Received incoming transfer with invalid expiresAt (' + packet.data.expiresAt + ')'))
        return
      }
      if (expiresAt < Date.now()) {
        debug('got incoming transfer with expired packet (' + packet.data.expiresAt + ')')
        this.emit('error', new Error('Received incoming transfer with an expired packet (' + packet.data.expiresAt + ')'))
        return
      }
    }

    // Try to fulfill condition
    const request = PaymentRequest.fromPacket(this, packet)
    const regeneratedPacket = request._getPacket()
    const condition = request._generateCondition(regeneratedPacket)
    if (condition.getConditionUri() !== transfer.executionCondition) {
      debug('got incoming transfer where the condition we generate from the packet (' + condition.getConditionUri() + ') does not match the executionCondition:', transfer)
      this.emit('error', new Error('Received incoming transfer where the condition we generate from the packet (' + condition.getConditionUri() + ') does not match the executionCondition (' + transfer.executionCondition + ')'))
      return
    }
    this.coreClient.fulfillCondition(transfer.id, condition.serializeUri())
      .then(() => this.emit('incoming', transfer, request))
      .catch((err) => this.emit('error', err))
  }
}

module.exports = Client
