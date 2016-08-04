'use strict'

const moment = require('moment')
const Client = require('ilp-core').Client
const debug = require('debug')('ilp:sender')

/**
 * @module Sender
 */

/**
 * Returns an ITP/ILP Sender to quote and pay for payment requests.
 *
 * @param  {LedgerPlugin} opts.plugin Ledger plugin used to connect to the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {Objct}  opts.auth Auth parameters for the ledger, passed to [ilp-core](https://github.com/interledger/js-ilp-core)
 * @param  {ilp-core.Client} [opts.client] [ilp-core](https://github.com/interledger/js-ilp-core) Client, which can optionally be supplied instead of the previous options
 * @param  {Buffer} [opts.maxHoldDuration=10] Maximum time in seconds to allow money to be held for
 * @return {Sender}
 */
function createSender (opts) {
  const client = opts.client || new Client(opts)

  const maxHoldDuration = opts.maxHoldDuration || 10

  /**
   * Quote a request from a receiver
   * @param  {Object} paymentRequest Payment request generated by an ITP/ILP Receiver
   * @return {Promise.<PaymentParams>} Resolves with the parameters that can be passed to payRequest
   */
  function quoteRequest (request) {
    if (!request.data.execution_condition) {
      return Promise.reject(new Error('Payment requests must have execution conditions'))
    }

    return client.connect()
      .then(() => client.waitForConnection())
      .then(() => client.quote({
        destinationAddress: request.account,
        destinationAmount: request.amount
      }))
      .then((quote) => {
        debug('got quote response', quote)
        if (!quote) {
          throw new Error('Got empty quote response from the connector')
        }
        return {
          sourceAmount: String(quote.sourceAmount),
          connectorAccount: quote.connectorAccount,
          destinationAmount: String(request.amount),
          destinationAccount: request.account,
          destinationMemo: {
            request_id: request.data.request_id,
            expires_at: request.data.expires_at
          },
          expiresAt: moment.min([
            moment(request.data.expires_at),
            moment().add(maxHoldDuration, 'seconds')
          ]).toISOString(),
          executionCondition: request.data.execution_condition
        }
      })
  }

  /**
   * Pay for a payment request
   * @param  {PaymentParams} paymentParams Respose from quoteRequest
   * @return {Promise.<String>} Resolves with the condition fulfillment
   */
  function payRequest (paymentParams) {
    return client.waitForConnection()
      .then(() => client.sendQuotedPayment(paymentParams))
      .then(() => {
        debug('payment sent', paymentParams)
        return new Promise((resolve, reject) => {
          // TODO just have one listener for the client
          const transferTimeout = setTimeout(() => {
            debug('transfer timed out')
            client.removeListener('fulfill_execution_condition', fulfillmentListener)
            reject(new Error('Transfer expired, money returned'))
          }, moment(paymentParams.expiresAt).diff(moment()))

          function fulfillmentListener (transfer, fulfillment) {
            if (transfer.executionCondition === paymentParams.executionCondition) {
              debug('outgoing transfer fulfilled', fulfillment, transfer)
              clearTimeout(transferTimeout)
              resolve(fulfillment)
            }
          }
          client.on('fulfill_execution_condition', fulfillmentListener)
        })
      })
  }

  return {
    quoteRequest,
    payRequest
  }
}

exports.createSender = createSender
