'use strict'

const Packet = require('../utils/packet')
const moment = require('moment')
const cryptoHelper = require('../utils/crypto')
const co = require('co')
const debug = require('debug')('ilp:transport')
const assert = require('assert')
const base64url = require('../utils/base64url')
const BigNumber = require('bignumber.js')
const { safeConnect } = require('../utils')
const { createDetails, parseDetails } = require('../utils/details')

function createPacketAndCondition ({
  destinationAmount,
  destinationAccount,
  secret,
  data,
  headers,
  publicHeaders,
  disableEncryption,
  expiresAt
}, protocol) {
  assert(typeof destinationAmount === 'string', 'destinationAmount must be a string')
  assert(typeof destinationAccount === 'string', 'destinationAccount must be a string')
  assert(Buffer.isBuffer(secret), 'secret must be a buffer')

  const receiverId = base64url(cryptoHelper.getReceiverId(secret))
  const address = destinationAccount + '.' + receiverId

  const details = createDetails({
    publicHeaders: Object.assign({}, publicHeaders),
    headers: Object.assign({
      'Expires-At': expiresAt
    }, headers),

    data,
    secret,
    disableEncryption
  })

  const packet = Packet.serialize({
    account: address,
    amount: destinationAmount,
    data: details
  })

  const condition = cryptoHelper.packetToCondition(secret, packet)

  return {
    packet,
    condition
  }
}

function _reject (plugin, id, reason) {
  return plugin
    .rejectIncomingTransfer(id, Object.assign({
      triggered_by: plugin.getAccount(),
      triggered_at: moment().format(),
      additional_info: {}
    }, reason))
    .then(() => reason)
}

function * listen (plugin, {
  secret,
  allowOverPayment
}, callback, protocol) {
  assert(plugin && typeof plugin === 'object', 'plugin must be an object')
  assert(typeof callback === 'function', 'callback must be a function')
  assert(Buffer.isBuffer(secret), 'opts.secret must be a buffer')

  yield safeConnect(plugin)

  /**
   * When we receive a transfer notification, check the transfer
   * and try to fulfill the condition (which will only work if
   * it corresponds to a request or shared secret we created)
   * Calls the `reviewPayment` callback before fulfillingthe.
   *
   * Note return values are only for testing
   */
  function * autoFulfillCondition (transfer) {
    // TODO: should this just be included in this function?
    const err = yield _validateOrRejectTransfer({
      plugin,
      transfer,
      protocol,
      allowOverPayment,
      secret
    })

    if (err) return err

    const preimage = cryptoHelper.packetToPreimage(
      Packet.getFromTransfer(transfer),
      secret)

    if (transfer.executionCondition !== cryptoHelper.preimageToCondition(preimage)) {
      debug('notified of transfer where executionCondition does not' +
        ' match the one we generate.' +
        ' executionCondition=' + transfer.executionCondition +
        ' our condition=' + cryptoHelper.preimageToCondition(preimage))
      return yield _reject(plugin, transfer.id, {
        code: 'S05',
        name: 'Wrong Condition',
        message: 'receiver generated a different condition from the transfer'
      })
    }

    const parsed = Packet.parseFromTransfer(transfer)
    const destinationAmount = parsed.amount
    const destinationAccount = parsed.account
    const data = parsed.data
    const details = parseDetails({ details: data, secret })
    const fulfillment = cryptoHelper.preimageToFulfillment(preimage)

    try {
      yield Promise.resolve(callback({
        transfer: transfer,
        publicHeaders: details.publicHeaders,
        headers: details.headers,
        data: details.data,
        destinationAccount,
        destinationAmount,
        fulfill: function () {
          return plugin.fulfillCondition(transfer.id, fulfillment)
        }
      }))
    } catch (e) {
      // reject immediately and pass the error if review rejects

      return _reject(plugin, transfer.id, {
        code: 'S00',
        name: 'Bad Request',
        message: 'rejected-by-receiver: ' +
          (e.message || 'reason not specified')
      })
    }

    return true
  }

  const listener = co.wrap(autoFulfillCondition)
  plugin.on('incoming_prepare', listener)

  return function () {
    plugin.removeListener('incoming_prepare', listener)
  }
}

function * _validateOrRejectTransfer ({
  plugin,
  transfer,
  protocol,
  allowOverPayment,
  secret
}) {
  const account = plugin.getAccount()
  const receiverId = base64url(cryptoHelper.getReceiverId(secret))

  if (!transfer.executionCondition) {
    debug('notified of transfer without executionCondition ', transfer)
    return yield _reject(plugin, transfer.id, {
      code: 'S00',
      name: 'Bad Request',
      message: 'got notification of transfer without executionCondition'
    })
  }

  if (!transfer.ilp && !transfer.data) {
    debug('got notification of transfer with no packet attached')
    return yield _reject(plugin, transfer.id, {
      code: 'S01',
      name: 'Invalid Packet',
      message: 'got notification of transfer with no packet attached'
    })
  }

  const parsed = Packet.parseFromTransfer(transfer)
  if (parsed === undefined) {
    return yield _reject(plugin, transfer.id, {
      code: 'S01',
      name: 'Invalid Packet',
      message: 'got notification of transfer with invalid ILP packet'
    })
  }

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

  if (addressReceiverId !== receiverId) {
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
      return yield _reject(plugin, transfer.id, {
        code: 'S06',
        name: 'Unexpected Payment',
        message: 'unsupported PSK version or status'
      })
    } else if (e.message === 'missing nonce') {
      return yield _reject(plugin, transfer.id, {
        code: 'S06',
        name: 'Unexpected Payment',
        message: 'missing PSK nonce'
      })
    } else if (e.message === 'unsupported key') {
      return yield _reject(plugin, transfer.id, {
        code: 'S06',
        name: 'Unexpected Payment',
        message: 'unsupported PSK key derivation'
      })
    } else if (e.message === 'unsupported encryption') {
      return yield _reject(plugin, transfer.id, {
        code: 'S06',
        name: 'Unexpected Payment',
        message: 'unsupported PSK encryption method'
      })
    } else {
      return yield _reject(plugin, transfer.id, {
        code: 'S06',
        name: 'Unexpected Payment',
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
    return yield _reject(plugin, transfer.id, {
      code: 'S04',
      name: 'Insufficient Destination Amount',
      message: 'got notification of transfer where amount is less than expected'
    })
  }

  if (!allowOverPayment && amount.greaterThan(destinationAmount)) {
    debug('notified of transfer amount larger than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    return yield _reject(plugin, transfer.id, {
      code: 'S03',
      name: 'Invalid Amount',
      message: 'got notification of transfer where amount is more than expected'
    })
  }

  if (expiresAt && moment().isAfter(expiresAt)) {
    debug('notified of transfer with expired packet:', transfer)
    return yield _reject(plugin, transfer.id, {
      code: 'R01',
      name: 'Payment Timed Out',
      message: 'got notification of transfer with expired packet'
    })
  }
}

module.exports = {
  _reject,
  _validateOrRejectTransfer: co.wrap(_validateOrRejectTransfer),
  createPacketAndCondition,
  listen: co.wrap(listen)
}
