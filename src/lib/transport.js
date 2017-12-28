'use strict'

const Packet = require('../utils/packet')
const IlpPacket = require('ilp-packet')
const ILQP = require('./ilqp')
const moment = require('moment')
const cryptoHelper = require('../utils/crypto')
const debug = require('debug')('ilp:transport')
const assert = require('assert')
const base64url = require('../utils/base64url')
const compat = require('ilp-compat-plugin')
const { codes } = require('../utils/ilp-errors')
const WrongConditionError = require('../errors/wrong-condition-error')
const ReceiverRejectionError = require('../errors/receiver-rejection-error')
const InvalidPacketError = require('../errors/invalid-packet-error')
const UnexpectedPaymentError = require('../errors/unexpected-payment-error')
const InsufficientDestinationAmountError = require('../errors/insufficient-destination-amount-error')
const InvalidAmountError = require('../errors/invalid-amount-error')
const TransferTimedOutError = require('../errors/transfer-timed-out-error')
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
  address,
  receiverSecret,
  allowOverPayment,
  connectTimeout
}, callback) {
  plugin = compat(plugin)

  assert(plugin && typeof plugin === 'object', 'plugin must be an object')
  assert(typeof callback === 'function', 'callback must be a function')
  assert(Buffer.isBuffer(receiverSecret), 'opts.receiverSecret must be a buffer')

  await safeConnect(plugin, connectTimeout)
  const dataHandler = handleData.bind(null, {
    plugin,
    address,
    receiverSecret,
    allowOverPayment,
    callback
  })

  plugin.registerDataHandler(dataHandler)

  return function () {
    plugin.deregisterDataHandler(dataHandler)
  }
}

function _parsePacket (packet) {
  // In order to make IPRv2 and PSKv1 work over ILPv4 without a lot of complex
  // packet reconstruction, we need to transmit the actual ILPv1 packets. An
  // easy way is to use the legacy packets as the payload for the modern ILPv4
  // packets.
  //
  // That means that the destination is duplicated. Otherwise it's actually
  // pretty clean.
  let transfer
  let parsedPacket
  try {
    transfer = IlpPacket.deserializeIlpPrepare(packet)
    parsedPacket = IlpPacket.deserializeIlpPayment(transfer.data)
    return { transfer, parsedPacket }
  } catch (e) {
    const errInfo = (e && e instanceof Object && e.stack) ? e.stack : e
    debug('error while parsing incoming packet. error=%s', errInfo)

    throw new InvalidPacketError('failed to parse packet. error=' + e)
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
async function handleData ({
  plugin,
  address,
  receiverSecret,
  allowOverPayment,
  callback: reviewFunction
}, packet) {
  try {
    switch (packet[0]) {
      case IlpPacket.Type.TYPE_ILP_PREPARE:
        break // Sharafian said to do it like this
      case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
      case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
      case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
        return ILQP._handleReceiverRequest({ packet, address })
      default:
        throw new InvalidPacketError('unknown packet type. type=' + packet[0])
    }
    const { transfer, parsedPacket } = _parsePacket(packet)
    debug('incoming packet. amount=%s', transfer.amount)

    // TODO: should this just be included in this function?
    await _validateOrRejectTransfer({
      plugin,
      address,
      transfer,
      parsedPacket,
      allowOverPayment,
      receiverSecret
    })

    const secret = _accountToSharedSecret({
      receiverSecret,
      account: parsedPacket.account,
      pluginAccount: address
    })
    const destinationAmount = parsedPacket.amount
    const destinationAccount = parsedPacket.account
    const data = parsedPacket.data
    const details = parseDetails({ details: data, secret })
    const preimage = cryptoHelper.packetToPreimage(
      transfer.data,
      secret)

    if (!transfer.executionCondition.equals(cryptoHelper.preimageToCondition(preimage))) {
      debug('notified of transfer where executionCondition does not' +
        ' match the one we generate.' +
        ' executionCondition=' + transfer.executionCondition.toString('base64') +
        ' ourCondition=' + cryptoHelper.preimageToCondition(preimage).toString('base64'))
      throw new WrongConditionError('receiver generated a different condition from the transfer')
    }

    const fulfillment = cryptoHelper.preimageToFulfillment(preimage)

    debug('calling callback to review transfer:', transfer, details)
    let result
    try {
      result = await Promise.resolve(reviewFunction({
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
    } catch (e) {
      // reject immediately and pass the error if review rejects
      const errInfo = (e && e instanceof Object && e.stack) ? e.stack : e
      debug('error in review callback for transfer:', errInfo)

      throw new ReceiverRejectionError('rejected-by-receiver: ' + (e.message || 'reason not specified'))
    }

    if (
      !(result instanceof Object) ||
      !Buffer.isBuffer(result.fulfillment) ||
      !result.fulfillment.equals(fulfillment)
    ) {
      debug('callback returned invalid fulfillment, rejecting transfer')
      throw new ReceiverRejectionError('rejected-by-receiver: receiver callback returned invalid fulfillment')
    }

    debug('fulfilling incoming transfer.')
    return IlpPacket.serializeIlpFulfill({
      fulfillment: result.fulfillment,
      data: result.data || Buffer.alloc(0)
    })
  } catch (e) {
    // Ensure error is an object
    let err = e
    if (!err || typeof err !== 'object') {
      err = new Error('Non-object thrown: ' + e)
    }

    const errInfo = e.stack ? e.stack : e

    const code = e.ilpErrorCode || codes.F00_BAD_REQUEST

    debug('rejecting incoming transfer. error=%s', errInfo)
    return IlpPacket.serializeIlpReject({
      code,
      message: err.message || err.name || 'unknown error',
      triggeredBy: address,
      data: Buffer.alloc(0)
    })
  }
}

function _validateOrRejectTransfer ({
  plugin,
  address,
  transfer,
  parsedPacket,
  allowOverPayment = true,
  receiverSecret
}) {
  const receiverId = base64url(cryptoHelper.getReceiverId(receiverSecret))

  const secret = _accountToSharedSecret({
    receiverSecret,
    account: parsedPacket.account,
    pluginAccount: address
  })
  const destinationAmount = parsedPacket.amount
  const destinationAccount = parsedPacket.account
  const data = parsedPacket.data

  if (destinationAccount.indexOf(address) !== 0) {
    debug('notified of transfer for another account: account=' +
      destinationAccount +
      ' me=' +
      address)
    throw new UnexpectedPaymentError('received payment for another account')
  }

  const localPart = destinationAccount.slice(address.length + 1)
  const [ addressReceiverId ] = localPart.split('.')

  if (!startsWith(receiverId, addressReceiverId)) {
    debug('notified of transfer for another receiver: receiver=' +
      addressReceiverId +
      ' me=' +
      receiverId)
    throw new UnexpectedPaymentError('received payment for another receiver')
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
      throw new UnexpectedPaymentError('unsupported PSK version or status')
    } else if (e.message === 'missing nonce') {
      throw new UnexpectedPaymentError('missing PSK nonce')
    } else if (e.message === 'unsupported key') {
      throw new UnexpectedPaymentError('unsupported PSK key derivation')
    } else if (e.message === 'unsupported encryption') {
      throw new UnexpectedPaymentError('unsupported PSK encryption method')
    } else {
      throw new UnexpectedPaymentError('unspecified PSK error')
    }
  }

  const expiresAt = details.headers['expires-at']
  const amount = new BigNumber(transfer.amount)

  if (amount.lessThan(destinationAmount)) {
    debug('notified of transfer amount smaller than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    throw new InsufficientDestinationAmountError('got notification of transfer where amount is less than expected')
  }

  if (!allowOverPayment && amount.greaterThan(destinationAmount)) {
    debug('notified of transfer amount larger than packet amount:' +
      ' transfer=' + transfer.amount +
      ' packet=' + destinationAmount)
    throw new InvalidAmountError('got notification of transfer where amount is more than expected')
  }

  if (expiresAt && moment().isAfter(expiresAt)) {
    debug('notified of transfer with expired packet:', transfer)
    throw new TransferTimedOutError('got notification of transfer with expired packet')
  }
}

module.exports = {
  createPacketAndCondition,
  listen,
  handleData,

  // Exported for unit tests
  _validateOrRejectTransfer
}
