'use strict'

const co = require('co')
const IlpPacket = require('ilp-packet')
const Packet = require('../utils/packet')
const debug = require('debug')('ilp:ilqp')
const moment = require('moment')
const BigNumber = require('bignumber.js')
const { safeConnect, startsWith, xor, omitUndefined } =
  require('../utils')

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
      if (quote.code) { // IlpError
        debug('remote quote error connector=' + connectors[c], 'ilpError=' + JSON.stringify(quote))
        throw new Error('remote quote error: ' + quote.name)
      } else if (quote) {
        quotes.push(Object.assign({connector: connectors[c]}, quote))
      } else {
        throw new Error('got empty quote response: ' + quote)
      }
    } catch (err) {
      errors.push(connectors[c] + ': ' + err.message)
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

function _deserializeQuoteResponse (responsePacket) {
  switch (responsePacket[0]) {
    case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_RESPONSE:
      return IlpPacket.deserializeIlqpBySourceResponse(responsePacket)
    case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_RESPONSE:
      return IlpPacket.deserializeIlqpByDestinationResponse(responsePacket)
    case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_RESPONSE:
      return IlpPacket.deserializeIlqpLiquidityResponse(responsePacket)
    case IlpPacket.Type.TYPE_ILP_ERROR:
      return IlpPacket.deserializeIlpError(responsePacket)
  }
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
    if (responseType === requestType + 1 || responseType === IlpPacket.Type.TYPE_ILP_ERROR) {
      return Object.assign({responseType}, _deserializeQuoteResponse(responsePacket))
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

module.exports = {
  _getCheaperQuote,
  quoteByConnector,
  quote: co.wrap(quote),
  quoteByPacket: co.wrap(quoteByPacket)
}
