'use strict'

const co = require('co')
const IlpPacket = require('ilp-packet')
const Packet = require('../utils/packet')
const debug = require('debug')('ilp:ilqp')
const moment = require('moment')
const BigNumber = require('bignumber.js')
const { safeConnect, startsWith, xor, omitUndefined } =
  require('../utils')
const uuid = require('uuid')

const DEFAULT_MESSAGE_TIMEOUT = 5000
const DEFAULT_EXPIRY_DURATION = 10

function * _handleConnectorResponses (connectors, promises) {
  if (connectors.length === 0) {
    throw new Error('no connectors specified')
  }

  const quotes = []
  const errors = []

  for (let c = 0; c < connectors.length; ++c) {
    try {
      const quote = yield promises[c]
      if (quote.responseType === IlpPacket.Type.TYPE_ILP_ERROR) {
        throw new Error('remote quote error: ' + quote.name)
      } else if (quote) {
        quotes.push(Object.assign({connector: connectors[c]}, quote))
      } else {
        throw new Error('got empty quote response: ' + quote)
      }
    } catch (err) {
      errors.push(connectors[c] + ': ' + (err.message || err))
    }
  }

  if (quotes.length === 0) {
    throw new Error('Errors occurred during quoting: ' +
      errors.join(', '))
  }

  return quotes
}

function _serializeQuoteRequest (requestParams) {
  if (requestParams.sourceAmount) {
    return IlpPacket.serializeIlqpBySourceRequest(requestParams)
  }
  if (requestParams.destinationAmount) {
    return IlpPacket.serializeIlqpByDestinationRequest(requestParams)
  }
  return IlpPacket.serializeIlqpLiquidityRequest(requestParams)
}

/**
  * @param {Object} params
  * @param {Object} params.plugin The LedgerPlugin used to send quote request
  * @param {String} params.connector The ILP address of the connector to quote from
  * @param {Object} params.quoteQuery ILQP request packet parameters
  * @param {Integer} [params.timeout] Milliseconds
  * @returns {Object} Ilqp{Liquidity,BySourceAmount,ByDestinationAmount}Response or IlpError
  */
function quoteByConnector ({
  plugin,
  connector,
  quoteQuery,
  timeout
}) {
  const prefix = plugin.getInfo().prefix
  const requestPacket = _serializeQuoteRequest(quoteQuery)
  const requestType = requestPacket[0]

  debug('remote quote connector=' + connector, 'query=' + JSON.stringify(quoteQuery))
  return plugin.sendRequest({
    ledger: prefix,
    from: plugin.getAccount(),
    to: connector,
    ilp: requestPacket.toString('base64'),
    timeout: timeout || DEFAULT_MESSAGE_TIMEOUT
  }).then((response) => {
    if (!response.ilp) throw new Error('Quote response has no packet')
    const responsePacket = Buffer.from(response.ilp, 'base64')
    const responseType = responsePacket[0]
    const packetData = IlpPacket.deserializeIlpPacket(responsePacket).data
    const isErrorPacket = responseType === IlpPacket.Type.TYPE_ILP_ERROR
    if (isErrorPacket) {
      debug('remote quote error connector=' + connector, 'ilpError=' + JSON.stringify(packetData))
    }
    if (isErrorPacket || responseType === requestType + 1) {
      return Object.assign({responseType}, packetData)
    }
    throw new Error('Quote response packet has incorrect type')
  })
}

function _getCheaperQuote (quote1, quote2) {
  if (quote1.sourceAmount) {
    const source1 = new BigNumber(quote1.sourceAmount)
    if (source1.lessThan(quote2.sourceAmount)) return quote1
  } else {
    const dest1 = new BigNumber(quote1.destinationAmount)
    if (dest1.greaterThan(quote2.destinationAmount)) return quote1
  }
  return quote2
}

/**
  * @module ILQP
  */

/**
  * @param {Object} plugin The LedgerPlugin used to send quote request
  * @param {Object} query
  * @param {String} query.sourceAddress Sender's address
  * @param {String} query.destinationAddress Recipient's address
  * @param {String} [query.sourceAmount] Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String} [query.destinationAmount] Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String|Number} [query.destinationExpiryDuration] Number of seconds between when the destination transfer is proposed and when it expires.
  * @param {Array} [query.connectors] List of ILP addresses of connectors to use for this quote.
  * @returns {Promise<Quote>}
  */
function * quote (plugin, {
  sourceAddress,
  destinationAddress,
  sourceAmount,
  destinationAmount,
  destinationExpiryDuration,
  connectors,
  timeout
}) {
  if (!xor(sourceAmount, destinationAmount)) {
    throw new Error('should provide source or destination amount but not both' +
      ' ' + JSON.stringify({ sourceAmount, destinationAmount }))
  }

  yield safeConnect(plugin)
  const prefix = plugin.getInfo().prefix
  const amount = sourceAmount || destinationAmount
  const destinationHoldDuration = +(destinationExpiryDuration || DEFAULT_EXPIRY_DURATION)

  if (startsWith(prefix, destinationAddress)) {
    debug('returning a local transfer to', destinationAddress, 'for', amount)
    return omitUndefined({
      // send directly to the destination
      connectorAccount: destinationAddress,
      sourceAmount: amount,
      destinationAmount: amount,
      sourceExpiryDuration: destinationHoldDuration.toString()
    })
  }

  const quoteQuery = omitUndefined({
    destinationAccount: destinationAddress,
    destinationHoldDuration: destinationHoldDuration * 1000,
    sourceAmount,
    destinationAmount
  })

  const quoteConnectors = connectors || plugin.getInfo().connectors || []
  debug('quoting', amount,
    (sourceAmount ? '(source amount)' : '(destination amount)'),
    'to', destinationAddress, 'via', quoteConnectors)

  // handle connector responses will return all successful quotes, or
  // throw all errors if there were none.
  const quotes = yield _handleConnectorResponses(
    quoteConnectors,
    quoteConnectors.map((connector) => {
      return quoteByConnector({ plugin, connector, quoteQuery, timeout })
    }))

  const bestQuote = quotes.reduce(_getCheaperQuote)
  const sourceHoldDuration = bestQuote.sourceHoldDuration / 1000
  debug('got best quote from connector:', bestQuote.connector, 'quote:', JSON.stringify(bestQuote))

  return omitUndefined({
    sourceAmount: sourceAmount || bestQuote.sourceAmount,
    destinationAmount: destinationAmount || bestQuote.destinationAmount,
    connectorAccount: bestQuote.connector,
    sourceExpiryDuration: sourceHoldDuration.toString(),
    // current time plus sourceExpiryDuration, for convenience
    expiresAt: moment()
      .add(sourceHoldDuration, 'seconds')
      .toISOString()
  })
}

function * quoteByPacket (plugin, packet) {
  const { account, amount } = Packet.parse(packet)
  return yield quote(plugin, {
    destinationAmount: amount,
    destinationAddress: account
  })
}

const END_TO_END_QUOTE_CONDITION = 'quotequotequotequotequotequotequotequotequo'
const QUOTE_ERROR_CODE = 'F08'
const QUOTE_ERROR_NAME = 'Quote'

// TODO make quoteSourceAmount and quoteDestinationAmount by multiplying the rate by the amount
// Returns destinationAmount
function quoteEndToEnd (plugin, {
  sourceAmount,
  destinationAccount,
  connector,
  sourceExpiryDuration
}) {
  // TODO handle if he don't know connector
  const connectorToUse = connector || plugin.getInfo().connectors[0]
  const timeout = sourceExpiryDuration || 10000

  const quoteTransfer = {
    id: uuid(),
    amount: sourceAmount,
    to: connectorToUse,
    ilp: IlpPacket.serializeIlpPayment({
      // TODO what if the amount is bigger than the destination ledger precision?
      amount: '999999', // '18446744073709551615', // max unsigned 64-bit integer
      account: destinationAccount,
    }),
    // TODO we should get the recipient to tell us how much time they saw the payment before the timeout
    expiresAt: new Date(Date.now() + timeout).toISOString(),
    // TODO should we hide the fact that we're requesting a quote?
    executionCondition: END_TO_END_QUOTE_CONDITION
  }

  const quoteResponsePromise = new Promise((resolve, reject) => {
    function onReject (transfer, rejectionReason) {
      if (transfer.id !== quoteTransfer.id) {
        return
      }

      if (rejectionReason.code === QUOTE_ERROR_CODE) {
        // TODO should the quote be encrypted?
        // TODO handle parsing errors
        const response = JSON.parse(rejectionReason.message)
        resolve({
          destinationAmount: response.amount,
          // TODO should we return something more like destinationHoldDuration?
          destinationExpiryDuration: response.timeToExpiry
        })
      } else if (rejectionReason.code === 'R00') {
        reject(new Error('Quote request timed out'))
      } else {
        reject(new Error('Quote request failed. Got error:' + rejectionReason.code + ' ' + rejectionReason.name + ': ' + rejectionReason.message))
      }
    }
    plugin.on('outgoing_reject', onReject)
    plugin.on('outgoing_cancel', onReject)

    setTimeout(() => {
      plugin.removeListener('outgoing_reject', onReject)
      plugin.removeListener('outgoing_cancel', onReject)
      reject(new Error('Quote request timed out'))
    }, timeout)
  })
  return plugin.sendTransfer(quoteTransfer)
    .then(() => quoteResponsePromise)
}


function listenForEndToEndQuotes (plugin) {
  function _onQuote (transfer) {
    if (transfer.executionCondition !== END_TO_END_QUOTE_CONDITION) {
      return
    }

    // TODO binary representation
    // TODO would you want to send any other data back?
    const response = JSON.stringify({
      amount: transfer.amount,
      timeToExpiry: Date.parse(transfer.expiresAt) - Date.now()
    })
    // TODO how do we make sure another receiver listening on the account doesn't reject the transfer first?
    plugin.rejectIncomingTransfer(transfer.id, {
      code: QUOTE_ERROR_CODE,
      name: QUOTE_ERROR_NAME,
      message: response,
      // TODO are these values supposed to be snake_case? inconsistent with rest of interface
      triggered_by: plugin.getAccount(),
      //triggered_at: new Date().toISOString(),
      additional_info: {}
    }).catch(err => console.log('error rejecting transfer', err))
  }

  plugin.on('incoming_prepare', _onQuote)

  return () => {
    plugin.removeListener('incoming_prepare', _onQuote)
  }
}

module.exports = {
  _getCheaperQuote,
  quoteByConnector,
  quote: co.wrap(quote),
  quoteByPacket: co.wrap(quoteByPacket),
  listenForEndToEndQuotes,
  quoteEndToEnd

}
