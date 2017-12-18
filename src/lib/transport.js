'use strict'

const Packet = require('../utils/packet')
const moment = require('moment')
const cryptoHelper = require('../utils/crypto')
const debug = require('debug')('ilp:transport')
const assert = require('assert')
const base64url = require('../utils/base64url')
const compat = require('ilp-compat-plugin')
const { createIlpError, codes } = require('../utils/ilp-errors')
const BigNumber = require('bignumber.js')
const { omitUndefined, startsWith, safeConnect } = require('../utils')
const { createDetails, parseDetails } = require('../utils/details')

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

async function listen (plugin, {
  receiverSecret,
  allowOverPayment,
  connectTimeout
}, callback) {
  plugin = compat(plugin)

  assert(plugin && typeof plugin === 'object', 'plugin must be an object')
  assert(typeof callback === 'function', 'callback must be a function')
  assert(Buffer.isBuffer(receiverSecret), 'opts.receiverSecret must be a buffer')

  await safeConnect(plugin, connectTimeout)
  const transferHandler = handleTransfer.bind(null, {
    plugin,
    receiverSecret,
    allowOverPayment,
    callback
  })

  plugin.registerTransferHandler(transferHandler)

  return function () {
    plugin.deregisterTransferHandler(transferHandler)
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
async function handleTransfer ({
  plugin,
  receiverSecret,
  allowOverPayment,
  callback: reviewFunction
}, transfer) {
  const account = plugin.getAccount()

  // TODO: should this just be included in this function?
  await _validateOrRejectTransfer({
    plugin,
    transfer,
    allowOverPayment,
    receiverSecret
  })

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

  if (!transfer.executionCondition.equals(cryptoHelper.preimageToCondition(preimage))) {
    debug('notified of transfer where executionCondition does not' +
      ' match the one we generate.' +
      ' executionCondition=' + transfer.executionCondition.toString('base64') +
      ' ourCondition=' + cryptoHelper.preimageToCondition(preimage).toString('base64'))
    throw createIlpError(plugin.getAccount(), {
      code: codes.F05_WRONG_CONDITION,
      message: 'receiver generated a different condition from the transfer'
    })
  }

  const fulfillment = cryptoHelper.preimageToFulfillment(preimage)

  debug('calling callback to review transfer:', transfer, details)
  try {
    const result = await Promise.resolve(reviewFunction({
      transfer: transfer,
      publicHeaders: details.publicHeaders,
      headers: details.headers,
      data: details.data,
      destinationAccount,
      destinationAmount,
      fulfillment,
      fulfill: function () {
        return {
          fulfillment
        }
      }
    }))

    if (
      !(result instanceof Object) ||
      !Buffer.isBuffer(result.fulfillment) ||
      !result.fulfillment.equals(fulfillment)
    ) {
      debug('callback returned invalid fulfillment, rejecting transfer')
      throw createIlpError(plugin.getAccount(), {
        code: codes.F00_BAD_REQUEST,
        message: 'rejected-by-receiver: receiver callback returned invalid fulfillment'
      })
    }

    return result
  } catch (e) {
    if (e instanceof Object && e.name === 'InterledgerRejectionError') {
      throw e
    }

    // reject immediately and pass the error if review rejects
    const errInfo = (e instanceof Object && e.stack) ? e.stack : e
    debug('error in review callback for transfer:', errInfo)

    throw createIlpError(plugin.getAccount(), {
      code: codes.F00_BAD_REQUEST,
      message: 'rejected-by-receiver: ' + (e.message || 'reason not specified')
    })
  }
}

function _validateOrRejectTransfer ({
  plugin,
  transfer,
  allowOverPayment = true,
  receiverSecret
}) {
  const account = plugin.getAccount()
  const receiverId = base64url(cryptoHelper.getReceiverId(receiverSecret))

  if (!transfer.executionCondition) {
    debug('notified of transfer without executionCondition ', transfer)
    throw createIlpError(plugin.getAccount(), {
      code: codes.F00_BAD_REQUEST,
      message: 'got notification of transfer without executionCondition'
    })
  }

  if (!transfer.ilp && !transfer.data) {
    debug('got notification of transfer with no packet attached')
    throw createIlpError(plugin.getAccount(), {
      code: codes.F01_INVALID_PACKET,
      message: 'got notification of transfer with no packet attached'
    })
  }

  const parsed = Packet.parseFromTransfer(transfer)
  if (parsed === undefined) {
    throw createIlpError(plugin.getAccount(), {
      code: codes.F01_INVALID_PACKET,
      message: 'got notification of transfer with invalid ILP packet'
    })
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
    throw createIlpError(plugin.getAccount(), {
      code: codes.F06_UNEXPECTED_PAYMENT,
      message: 'received payment for another account'
    })
  }

  const localPart = destinationAccount.slice(account.length + 1)
  const [ addressReceiverId ] = localPart.split('.')

  if (!startsWith(receiverId, addressReceiverId)) {
    debug('notified of transfer for another receiver: receiver=' +
      addressReceiverId +
      ' me=' +
      receiverId)
    throw createIlpError(plugin.getAccount(), {
      code: codes.F06_UNEXPECTED_PAYMENT,
      message: 'received payment for another receiver'
    })
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
      throw createIlpError(plugin.getAccount(), {
        code: codes.F06_UNEXPECTED_PAYMENT,
        message: 'unsupported PSK version or status'
      })
    } else if (e.message === 'missing nonce') {
      throw createIlpError(plugin.getAccount(), {
        code: codes.F06_UNEXPECTED_PAYMENT,
        message: 'missing PSK nonce'
      })
    } else if (e.message === 'unsupported key') {
      throw createIlpError(plugin.getAccount(), {
        code: codes.F06_UNEXPECTED_PAYMENT,
        message: 'unsupported PSK key derivation'
      })
    } else if (e.message === 'unsupported encryption') {
      throw createIlpError(plugin.getAccount(), {
        code: codes.F06_UNEXPECTED_PAYMENT,
        message: 'unsupported PSK encryption method'
      })
    } else {
      throw createIlpError(plugin.getAccount(), {
        code: codes.F06_UNEXPECTED_PAYMENT,
        message: 'unspecified PSK error'
      })
    }
  }

  const expiresAt = details.headers['expires-at']
  const amount = new BigNumber(transfer.amount)

  if (amount.lessThan(destinationAmount)) {
    debug('notified of transfer amount smaller than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    throw createIlpError(plugin.getAccount(), {
      code: codes.F04_INSUFFICIENT_DESTINATION_AMOUNT,
      message: 'got notification of transfer where amount is less than expected'
    })
  }

  if (!allowOverPayment && amount.greaterThan(destinationAmount)) {
    debug('notified of transfer amount larger than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    throw createIlpError(plugin.getAccount(), {
      code: codes.F03_INVALID_AMOUNT,
      message: 'got notification of transfer where amount is more than expected'
    })
  }

  if (expiresAt && moment().isAfter(expiresAt)) {
    debug('notified of transfer with expired packet:', transfer)
    throw createIlpError(plugin.getAccount(), {
      code: codes.R00_TRANSFER_TIMED_OUT,
      message: 'got notification of transfer with expired packet'
    })
  }
}

module.exports = {
  createPacketAndCondition,
  listen,
  handleTransfer,

  // Exported for unit tests
  _validateOrRejectTransfer
}
