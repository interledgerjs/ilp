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

// The first 10 underscores indicate that other listeners should ignore
// these transfers unless they specifically recognize the condition
const QUOTE_CONDITION = '__________ilqp_v2-0________________________'
const QUOTE_ERROR_CODE = 'F08'
const QUOTE_ERROR_NAME = 'ILQPv2.0'
const DEFAULT_QUOTE_TIMEOUT = 10000 // milliseconds
const DEFAULT_EXPIRY_DURATION = 10 // seconds
const MAX_UINT64 = '18446744073709551615'
// TODO how do we set this amount? what if it's not enough to get to the other side?
const PROBE_SOURCE_AMOUNT = '10000'

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
  debug('quote by connector: ', connector, quoteQuery)
  const isSourceQuote = quoteQuery.hasOwnProperty('sourceAmount')

  const sourceAmount = isSourceQuote ? quoteQuery.sourceAmount : PROBE_SOURCE_AMOUNT
  // TODO add an option to specify the sourceExpiryDuration instead of the destination
  // TODO maybe increase timeout if the first attempt fails
  const quoteTransferTimeout = timeout || DEFAULT_QUOTE_TIMEOUT
  const ilp = IlpPacket.serializeIlpPayment({
    amount: MAX_UINT64,
    account: quoteQuery.destinationAccount,
  }).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const quoteTransfer = {
    id: uuid(),
    amount: sourceAmount,
    to: connector,
    ilp,
    expiresAt: new Date(Date.now() + quoteTransferTimeout).toISOString(),
    executionCondition: QUOTE_CONDITION
  }

  const quoteResponsePromise = new Promise((resolve, reject) => {
    function onReject (transfer, rejectionReason) {
      if (transfer.id !== quoteTransfer.id) {
        return
      }

      debug('quote transfer rejected with message:', rejectionReason)

      if (rejectionReason.code === QUOTE_ERROR_CODE && rejectionReason.name === QUOTE_ERROR_NAME) {
        debug('got quote response')
        // TODO should the quote be encrypted?
        // TODO handle parsing errors
        const response = JSON.parse(rejectionReason.message)
        const sourceHoldDuration = quoteTransferTimeout + quoteQuery.destinationHoldDuration - response.timeToExpiry

        if (isSourceQuote) {
          resolve({
            sourceAmount: quoteQuery.sourceAmount,
            destinationAmount: response.amount,
            sourceHoldDuration
          })
        } else {
          const sourceAmount = new BigNumber(quoteQuery.destinationAmount)
            .dividedBy(response.amount)
            .times(PROBE_SOURCE_AMOUNT)
            .round(0, BigNumber.ROUND_UP)
            .toString(10)
          resolve({
            sourceAmount,
            destinationAmount: quoteQuery.destinationAmount,
            sourceHoldDuration
          })
        }
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
    }, quoteTransferTimeout + 100) // TODO don't use hardcoded value here
  })
  return plugin.sendTransfer(quoteTransfer)
    .then(() => quoteResponsePromise)
    .then((quoteResponse) => {
      debug('quote response:', quoteResponse)
      return quoteResponse
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
  * @param {String} query.sourceAccount Sender's address
  * @param {String} query.destinationAccount Recipient's address
  * @param {String} [query.sourceAmount] Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String} [query.destinationAmount] Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger.
  * @param {String|Number} [query.destinationExpiryDuration] Number of seconds between when the destination transfer is proposed and when it expires.
  * @param {Array} [query.connectors] List of ILP addresses of connectors to use for this quote.
  * @returns {Promise<Quote>}
  */
function * quote (plugin, {
  sourceAccount,
  destinationAccount,
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

  if (startsWith(prefix, destinationAccount)) {
    debug('returning a local transfer to', destinationAccount, 'for', amount)
    return omitUndefined({
      // send directly to the destination
      connectorAccount: destinationAccount,
      sourceAmount: amount,
      destinationAmount: amount,
      sourceExpiryDuration: destinationHoldDuration.toString()
    })
  }

  const quoteQuery = omitUndefined({
    destinationAccount: destinationAccount,
    destinationHoldDuration: destinationHoldDuration * 1000,
    sourceAmount,
    destinationAmount
  })

  const quoteConnectors = connectors || plugin.getInfo().connectors || []
  debug('quoting', amount,
    (sourceAmount ? '(source amount)' : '(destination amount)'),
    'to', destinationAccount, 'via', quoteConnectors)

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

function listenForEndToEndQuotes (plugin) {
  function _onQuote (transfer) {
    if (transfer.executionCondition !== QUOTE_CONDITION) {
      return
    }

    // TODO handle parsing errors or if packet is not present
    const packet = IlpPacket.deserializeIlpPayment(Buffer.from(transfer.ilp, 'base64'))

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
  listenForEndToEndQuotes
}
