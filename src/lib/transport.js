'use strict'

const Packet = require('../utils/packet')
const moment = require('moment')
const cryptoHelper = require('../utils/crypto')
const debug = require('debug')('ilp:transport')
const assert = require('assert')
const base64url = require('../utils/base64url')
const ilpErrors = require('../utils/ilp-errors')
const BigNumber = require('bignumber.js')
const { retryPromise, omitUndefined, startsWith, safeConnect } = require('../utils')
const { createDetails, parseDetails } = require('../utils/details')

const DEFAULT_MIN_FULFILL_RETRY_WAIT = 250
const DEFAULT_MAX_FULFILL_RETRY_WAIT = 1000

function createPacketAndCondition ({
  destinationAmount,
  destinationAccount,
  secret,
  data,
  headers,
  publicHeaders,
  nonce,
  disableEncryption,
  expiresAt
}) {
  assert(typeof destinationAmount === 'string', 'destinationAmount must be a string')
  assert(typeof destinationAccount === 'string', 'destinationAccount must be a string')
  assert(Buffer.isBuffer(secret), 'secret must be a buffer')

  const details = createDetails({
    publicHeaders: Object.assign({}, publicHeaders),
    headers: Object.assign(omitUndefined({
      'Expires-At': expiresAt
    }), headers),

    data,
    nonce,
    secret,
    disableEncryption
  })

  const packet = Packet.serialize({
    account: destinationAccount,
    amount: destinationAmount,
    data: details
  })

  const condition = cryptoHelper.packetToCondition(secret, packet)

  return {
    packet,
    condition
  }
}

function _accountToSharedSecret ({ account, pluginAccount, receiverSecret }) {
  const localPart = account.slice(pluginAccount.length + 1)
  const receiverId = base64url(cryptoHelper.getReceiverId(receiverSecret))
  const token = Buffer.from(localPart.slice(receiverId.length), 'base64')

  return cryptoHelper.getPskSharedSecret(receiverSecret, token)
}

function _reject (plugin, id, reason) {
  debug('rejecting incoming transfer:', id, reason)
  return plugin
    .rejectIncomingTransfer(id, Object.assign({
      triggered_by: plugin.getAccount(),
      triggered_at: moment().toISOString(),
      additional_info: {}
    }, reason))
    .then(() => reason)
}

async function listen (plugin, {
  receiverSecret,
  allowOverPayment = true,
  minFulfillRetryWait,
  maxFulfillRetryWait,
  connectTimeout
}, callback) {
  assert(plugin && typeof plugin === 'object', 'plugin must be an object')
  assert(typeof callback === 'function', 'callback must be a function')
  assert(Buffer.isBuffer(receiverSecret), 'opts.receiverSecret must be a buffer')

  await safeConnect(plugin, connectTimeout)
  async function autoFulfillCondition (transfer) {
    return _autoFulfillCondition({
      transfer,
      plugin,
      receiverSecret,
      allowOverPayment,
      minFulfillRetryWait,
      maxFulfillRetryWait,
      callback
    })
  }

  const listener = autoFulfillCondition
  plugin.on('incoming_prepare', listener)

  return function () {
    plugin.removeListener('incoming_prepare', listener)
  }
}

async function listenAll (factory, {
  generateReceiverSecret,
  allowOverPayment = true,
  minFulfillRetryWait,
  maxFulfillRetryWait,
  connectTimeout
}, callback) {
  assert(factory && typeof factory === 'object', 'factory must be an object')
  assert(typeof callback === 'function', 'callback must be a function')
  assert(typeof generateReceiverSecret === 'function', 'opts.generateReceiverSecret must be a function')

  await safeConnect(factory, connectTimeout)
  async function autoFulfillCondition (username, transfer) {
    const pluginAsUser = {
      getAccount: factory.getAccountAs.bind(factory, username),
      rejectIncomingTransfer: factory.rejectIncomingTransferAs.bind(factory, username),
      fulfillCondition: factory.fulfillConditionAs.bind(factory, username)
    }

    const receiverSecret = generateReceiverSecret(pluginAsUser.getAccount())
    const result = await _autoFulfillCondition({
      plugin: pluginAsUser,
      transfer,
      receiverSecret,
      allowOverPayment,
      minFulfillRetryWait,
      maxFulfillRetryWait,
      callback
    })

    return result
  }

  const listener = autoFulfillCondition
  factory.on('incoming_prepare', listener)

  return function () {
    factory.removeListener('incoming_prepare', listener)
  }
}

/**
  * When we receive a transfer notification, check the transfer
  * and try to fulfill the condition (which will only work if
  * it corresponds to a request or shared secret we created)
  * Calls the `reviewPayment` callback before fulfillingthe.
  *
  * Note return values are only for testing
  */
async function _autoFulfillCondition ({
  transfer,
  plugin,
  receiverSecret,
  allowOverPayment,
  minFulfillRetryWait,
  maxFulfillRetryWait,
  callback: reviewFunction
}) {
  const account = plugin.getAccount()

  // TODO: should this just be included in this function?
  const err = await _validateOrRejectTransfer({
    plugin,
    transfer,
    allowOverPayment,
    receiverSecret
  })

  if (err) return err

  const parsed = Packet.parseFromTransfer(transfer)
  const secret = _accountToSharedSecret({
    receiverSecret,
    account: parsed.account,
    pluginAccount: account
  })
  const destinationAmount = parsed.amount
  const destinationAccount = parsed.account
  const data = parsed.data
  const details = parseDetails({ details: data, secret })
  const preimage = cryptoHelper.packetToPreimage(
    Packet.getFromTransfer(transfer),
    secret)

  if (transfer.executionCondition !== cryptoHelper.preimageToCondition(preimage)) {
    debug('notified of transfer where executionCondition does not' +
      ' match the one we generate.' +
      ' transfer.id=' + transfer.id +
      ' executionCondition=' + transfer.executionCondition +
      ' our condition=' + cryptoHelper.preimageToCondition(preimage))
    return _reject(plugin, transfer.id, ilpErrors.F05_Wrong_Condition({
      message: 'receiver generated a different condition from the transfer'
    }))
  }

  const fulfillment = cryptoHelper.preimageToFulfillment(preimage)

  debug('calling callback to review transfer:', transfer, details)
  try {
    await Promise.resolve(reviewFunction({
      transfer: transfer,
      publicHeaders: details.publicHeaders,
      headers: details.headers,
      data: details.data,
      destinationAccount,
      destinationAmount,
      fulfillment,
      fulfill: function () {
        return retryPromise({
          callback: () => {
            debug('fulfilling transfer:', transfer.id, 'with fulfillment:', fulfillment)
            return plugin.fulfillCondition(transfer.id, fulfillment)
          },
          minWait: minFulfillRetryWait || DEFAULT_MIN_FULFILL_RETRY_WAIT,
          maxWait: maxFulfillRetryWait || DEFAULT_MAX_FULFILL_RETRY_WAIT,
          stopWaiting: (new Date(transfer.expiresAt))
        })
      }
    }))
  } catch (e) {
    // reject immediately and pass the error if review rejects
    debug('error in review callback for transfer:', transfer.id, e)

    return _reject(plugin, transfer.id, ilpErrors.F00_Bad_Request({
      message: 'rejected-by-receiver: ' +
        (e.message || 'reason not specified')
    }))
  }

  return true
}

async function _validateOrRejectTransfer ({
  plugin,
  transfer,
  allowOverPayment,
  receiverSecret
}) {
  const account = plugin.getAccount()
  const receiverId = base64url(cryptoHelper.getReceiverId(receiverSecret))

  if (!transfer.executionCondition) {
    debug('notified of transfer without executionCondition ', transfer)
    return _reject(plugin, transfer.id, ilpErrors.F00_Bad_Request({
      message: 'got notification of transfer without executionCondition'
    }))
  }

  if (!transfer.ilp && !transfer.data) {
    debug('got notification of transfer with no packet attached')
    return _reject(plugin, transfer.id, ilpErrors.F01_Invalid_Packet({
      message: 'got notification of transfer with no packet attached'
    }))
  }

  const parsed = Packet.parseFromTransfer(transfer)
  if (parsed === undefined) {
    return _reject(plugin, transfer.id, ilpErrors.F01_Invalid_Packet({
      message: 'got notification of transfer with invalid ILP packet'
    }))
  }

  const secret = _accountToSharedSecret({
    receiverSecret,
    account: parsed.account,
    pluginAccount: account
  })
  const destinationAmount = parsed.amount
  const destinationAccount = parsed.account
  const data = parsed.data

  if (destinationAccount.indexOf(account) !== 0) {
    debug('notified of transfer for another account: account=' +
      destinationAccount +
      ' me=' +
      account)
    return 'not-my-packet'
  }

  const localPart = destinationAccount.slice(account.length + 1)
  const [ addressReceiverId ] = localPart.split('.')

  if (!startsWith(receiverId, addressReceiverId)) {
    debug('notified of transfer for another receiver: receiver=' +
      addressReceiverId +
      ' me=' +
      receiverId)
    return 'not-my-packet'
  }

  let details
  try {
    details = parseDetails({ details: data, secret })
  } catch (e) {
    // reject messages based off of invalid PSK format
    debug('error parsing PSK data transferId=' +
      transfer.id + ' data=' +
      base64url(data) + ' message=' +
      e.stack)

    if (e.message === 'unsupported status') {
      return _reject(plugin, transfer.id, ilpErrors.F06_Unexpected_Payment({
        message: 'unsupported PSK version or status'
      }))
    } else if (e.message === 'missing nonce') {
      return _reject(plugin, transfer.id, ilpErrors.F06_Unexpected_Payment({
        message: 'missing PSK nonce'
      }))
    } else if (e.message === 'unsupported key') {
      return _reject(plugin, transfer.id, ilpErrors.F06_Unexpected_Payment({
        message: 'unsupported PSK key derivation'
      }))
    } else if (e.message === 'unsupported encryption') {
      return _reject(plugin, transfer.id, ilpErrors.F06_Unexpected_Payment({
        message: 'unsupported PSK encryption method'
      }))
    } else {
      return _reject(plugin, transfer.id, ilpErrors.F06_Unexpected_Payment({
        message: 'unspecified PSK error'
      }))
    }
  }

  const expiresAt = details.headers['expires-at']
  const amount = new BigNumber(transfer.amount)

  if (amount.lessThan(destinationAmount)) {
    debug('notified of transfer amount smaller than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    return _reject(plugin, transfer.id, ilpErrors.F04_Insufficient_Destination_Amount({
      message: 'got notification of transfer where amount is less than expected'
    }))
  }

  if (!allowOverPayment && amount.greaterThan(destinationAmount)) {
    debug('notified of transfer amount larger than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    return _reject(plugin, transfer.id, ilpErrors.F03_Invalid_Amount({
      message: 'got notification of transfer where amount is more than expected'
    }))
  }

  if (expiresAt && moment().isAfter(expiresAt)) {
    debug('notified of transfer with expired packet:', transfer)
    return _reject(plugin, transfer.id, ilpErrors.R00_Transfer_Timed_Out({
      message: 'got notification of transfer with expired packet'
    }))
  }
}

module.exports = {
  _reject,
  _autoFulfillCondition,
  _validateOrRejectTransfer: _validateOrRejectTransfer,
  createPacketAndCondition,
  listen: listen,
  listenAll: listenAll
}
