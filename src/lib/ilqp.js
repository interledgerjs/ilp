'use strict'

const co = require('co')
const Packet = require('../utils/packet')
const debug = require('debug')('ilp:ilqp')
const moment = require('moment')
const BigNumber = require('bignumber.js')
const uuid = require('uuid')
const { safeConnect, startsWith, wait, xor, omitUndefined } =
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
      if (quote) {
        quotes.push(quote)
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

function _sendAndReceiveMessage ({
  plugin,
  responseMethod,
  message,
  timeout
}) {
  const id = message.data.id = message.data.id || uuid()
  debug('sending message:', JSON.stringify(message))

  const responded = new Promise((resolve, reject) => {
    function onIncomingMessage (response) {
      debug('got incoming message:', JSON.stringify(response))
      const data = response.data

      if (!data || data.id !== id) return
      if (data.method === 'error') reject(data.data.message)

      if (data.method === responseMethod) {
        debug('response of type', responseMethod)
        plugin.removeListener('incoming_message', onIncomingMessage)
        resolve(response)
      }
    }

    // TODO: optimize to not add a listener each time?
    plugin.on('incoming_message', onIncomingMessage)
  })

  return Promise.race([
    plugin.sendMessage(message).then(() => responded),
    wait(timeout || DEFAULT_MESSAGE_TIMEOUT)
      .then(() => { throw new Error('quote request timed out') })
  ])
}

function _getQuote ({
  plugin,
  connector,
  quoteQuery,
  timeout
}) {
  const prefix = plugin.getInfo().prefix

  debug('remote quote connector=' + connector, 'query=' + JSON.stringify(quoteQuery))
  return _sendAndReceiveMessage({
    plugin: plugin,
    responseMethod: 'quote_response',
    timeout: timeout,
    message: {
      ledger: prefix,
      to: connector,
      data: {
        method: 'quote_request',
        data: quoteQuery
      }
    }
  }).then((response) => {
    return response.data.data
  })
}

function _getCheaperQuote (quote1, quote2) {
  const source1 = new BigNumber(quote1.source_amount)
  const dest1 = new BigNumber(quote1.destination_amount)

  if (source1.lessThan(quote2.source_amount)) return quote1
  if (dest1.greaterThan(quote2.destination_amount)) return quote1

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
  * @param {String|Number} [query.sourceExpiryDuration] Number of seconds between when the source transfer is proposed and when it expires.
  * @param {String|Number} [query.destinationExpiryDuration] Number of seconds between when the destination transfer is proposed and when it expires.
  * @param {Array} [query.connectors] List of ILP addresses of connectors to use for this quote.
  * @returns {Promise<Quote>}
  */
function * quote (plugin, {
  sourceAddress,
  destinationAddress,
  sourceAmount,
  destinationAmount,
  sourceExpiryDuration,
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

  if (startsWith(prefix, destinationAddress)) {
    debug('returning a local transfer to', destinationAddress, 'for', amount)
    return omitUndefined({
      // send directly to the destination
      connectorAccount: destinationAddress,
      sourceAmount: amount,
      destinationAmount: amount,
      sourceExpiryDuration: destinationExpiryDuration
    })
  }

  const quoteQuery = omitUndefined({
    source_address: plugin.getAccount(),
    source_amount: sourceAmount,
    destination_address: destinationAddress,
    destination_amount: destinationAmount,
    destination_expiry_duration: destinationExpiryDuration
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
      return _getQuote({ plugin, connector, quoteQuery, timeout })
    }))

  const bestQuote = quotes.reduce(_getCheaperQuote)
  debug('got best quote from connector:', JSON.stringify(bestQuote))

  return omitUndefined({
    sourceAmount: sourceAmount || bestQuote.source_amount,
    destinationAmount: destinationAmount || bestQuote.destination_amount,
    // try to send directly to the destination if there's no connector
    connectorAccount: bestQuote.source_connector_account || destinationAddress,
    sourceExpiryDuration: bestQuote.source_expiry_duration ||
      DEFAULT_EXPIRY_DURATION,
    // current time plus sourceExpiryDuration, for convenience
    expiresAt: moment()
      .add(
        bestQuote.source_expiry_duration || DEFAULT_EXPIRY_DURATION,
        'seconds')
      .format()
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
  _sendAndReceiveMessage,
  _getQuote,
  _getCheaperQuote,
  quote: co.wrap(quote),
  quoteByPacket: co.wrap(quoteByPacket)
}
