'use strict'

const assert = require('assert')
const crypto = require('crypto')
const Debug = require('debug')
const BigNumber = require('bignumber.js')
const oer = require('oer-utils')
const Long = require('long')
const base64url = require('../utils/base64url')
const convertToV2Plugin = require('ilp-compat-plugin')

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const PSK_FULFILLMENT_STRING = 'ilp_psk2_fulfillment'
const PSK_ENCRYPTION_STRING = 'ilp_psk2_encryption'
const NONCE_LENGTH = 18
const AUTH_TAG_LENGTH = 16
const NULL_CONDITION_BUFFER = Buffer.alloc(32, 0)
const DEFAULT_TRANSFER_TIMEOUT = 2000
const STARTING_TRANSFER_AMOUNT = 1000
const TRANSFER_INCREASE = 1.1
const TRANSFER_DECREASE = 0.5

const MAX_UINT_64 = new BigNumber('18446744073709551615')

const TYPE_QUOTE = 0
const TYPE_CHUNK = 1
const TYPE_LAST_CHUNK = 2

async function quote (plugin, {
  sourceAmount,
  destinationAmount,
  sharedSecret,
  destination,
  connector,
  randomCondition
}) {
  plugin = convertToV2Plugin(plugin)
  const debug = Debug('ilp-psk2:quote')
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(sourceAmount || destinationAmount, 'either sourceAmount or destinationAmount is required')
  assert(!sourceAmount || !destinationAmount, 'cannot supply both sourceAmount and destinationAmount')
  const executionCondition = base64url(randomCondition ? crypto.randomBytes(32) : NULL_CONDITION_BUFFER)
  const sourceQuote = !!sourceAmount
  const amount = sourceAmount || STARTING_TRANSFER_AMOUNT

  debug(`sending transfer with source amount: ${amount}`)

  // TODO should we include some junk data to make it as long as the data for a payment?
  const headers = new oer.Writer()
  headers.writeUInt8(TYPE_QUOTE)
  const data = encrypt(sharedSecret, headers.getBuffer())

  const transfer = {
    amount,
    executionCondition,
    expiresAt: new Date(Date.now() + DEFAULT_TRANSFER_TIMEOUT).toISOString(),
    destination,
    data
  }

  try {
    await plugin.sendTransfer(transfer)
  } catch (err) {
    if (!err.ilpRejection || err.ilpRejection.code !== 'F99') {
      throw err
    }
    debug(`got quote response:`, err.ilpRejection)
    try {
      let additionalInfo = err.ilpRejection.additionalInfo
      // TODO we probably shouldn't need to do this if additionalInfo is supposed to be an object
      if (typeof additionalInfo === 'string') {
        additionalInfo = JSON.parse(additionalInfo)
      }
      const decryptedResponse = decrypt(sharedSecret, additionalInfo.message)
      const responseReader = new oer.Reader(decryptedResponse)
      const amountArrived = highLowToBigNumber(responseReader.readUInt64())
      debug(`receiver got: ${amountArrived.toString(10)} when sender sent: ${amount}`)
      if (sourceQuote) {
        return {
          destinationAmount: amountArrived.toString(10)
        }
      } else {
        const sourceAmount = new BigNumber(destinationAmount)
          .div(amountArrived)
          .times(STARTING_TRANSFER_AMOUNT)
          .round(0, 1)
        return {
          sourceAmount: sourceAmount.toString(10)
        }
      }
    } catch (decryptionErr) {
      debug('error parsing encrypted quote response', decryptionErr)
      throw err
    }
  }
}

async function send (plugin, {
  sourceAmount,
  sharedSecret,
  destination,
  connector
}) {
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(sourceAmount, 'sourceAmount is required')
  return sendChunkedPayment(plugin, { sourceAmount, sharedSecret, destination, connector })
}

// TODO connector shouldn't need to be passed in here
async function deliver (plugin, {
  destinationAmount,
  sharedSecret,
  destination,
  connector
}) {
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(destinationAmount, 'destinationAmount is required')
  return sendChunkedPayment(plugin, { destinationAmount, sharedSecret, destination, connector })
}

// TODO add option not to chunk the payment
async function sendChunkedPayment (plugin, {
  sharedSecret,
  destination,
  sourceAmount,
  destinationAmount,
  connector
}) {
  plugin = convertToV2Plugin(plugin)
  const debug = Debug('ilp-psk2:chunkedPayment')
  const secret = Buffer.from(sharedSecret, 'base64')
  const paymentId = crypto.randomBytes(16)
  let amountSent = new BigNumber(0)
  let amountDelivered = new BigNumber(0)
  let numChunks = 0

  const headersWriter = new oer.Writer()
  headersWriter.writeUInt8(TYPE_CHUNK)
  headersWriter.write(paymentId)
  if (destinationAmount) {
    const destinationAmountLong = Long.fromString(destinationAmount)
    headersWriter.writeUInt64([destinationAmountLong.getHighBitsUnsigned(), destinationAmountLong.getLowBitsUnsigned()])
  } else {
    headersWriter.writeUInt64(0)
  }
  const headers = headersWriter.getBuffer()

  let chunkSize = new BigNumber(STARTING_TRANSFER_AMOUNT)
  let timeToWait = 0
  while (true) {
    // Figure out if we've sent enough already
    let amountLeftToSend
    if (sourceAmount) {
      amountLeftToSend = new BigNumber(sourceAmount).minus(amountSent)
    } else {
      const amountLeftToDeliver = new BigNumber(destinationAmount).minus(amountDelivered)
      if (amountLeftToDeliver.lte(0)) {
        break
      }
      if (amountSent.gt(0)) {
        const rate = amountDelivered.div(amountSent)
        amountLeftToSend = amountLeftToDeliver.div(rate).round(0, BigNumber.ROUND_CEIL) // round up
      } else {
        // We don't know how much more we need to send
        amountLeftToSend = MAX_UINT_64
      }
    }

    if (amountLeftToSend.lte(0)) {
      break
    } else if (amountLeftToSend.lte(chunkSize)) {
      debug('sending last chunk')
      chunkSize = amountLeftToSend
      headers.writeUInt8(TYPE_LAST_CHUNK, 0)
    }

    // TODO accept user data also
    const data = encrypt(secret, headers)
    const fulfillment = dataToFulfillment(secret, data)
    const executionCondition = base64url(hash(fulfillment))

    debug(`sending chunk of: ${chunkSize.toString(10)}`)
    const transfer = {
      destination,
      data,
      amount: chunkSize.toString(10),
      expiresAt: new Date(Date.now() + DEFAULT_TRANSFER_TIMEOUT).toISOString(),
      executionCondition
    }

    try {
      const result = await plugin.sendTransfer(transfer)
      amountSent = amountSent.plus(transfer.amount)
      numChunks++
      chunkSize = chunkSize.times(TRANSFER_INCREASE).round(0)
      debug('transfer was successful, increasing chunk size to:', chunkSize.toString(10))
      timeToWait = 0
      try {
        const decryptedData = decrypt(secret, result.data)
        const dataReader = new oer.Reader(decryptedData)
        const amountReceived = highLowToBigNumber(dataReader.readUInt64())
        debug(`receiver says they have received: ${amountReceived.toString(10)}`)
        if (amountReceived.gt(amountDelivered)) {
          amountDelivered = amountReceived
        }
      } catch (err) {
        // TODO update amount delivered somehow so not getting the response back
        // doesn't affect our view of the exchange rate
        debug('error decrypting response data:', err, result)
        continue
      }
    } catch (err) {
      // TODO handle specific errors
      debug('got error sending payment chunk:', err)
      chunkSize = chunkSize.times(TRANSFER_DECREASE).round(0)
      if (chunkSize.lt(1)) {
        chunkSize = new BigNumber(1)
      }
      timeToWait = Math.max(timeToWait * 2, 100)
      await new Promise((resolve, reject) => setTimeout(resolve, timeToWait))
    }
  }

  debug(`sent payment. source amount: ${amountSent.toString(10)}, destination amount: ${amountDelivered.toString(10)}, number of chunks: ${numChunks}`)

  return {
    sourceAmount: amountSent.toString(10),
    destinationAmount: amountDelivered.toString(10),
    numChunks
  }
}

function listen (plugin, { secret, notifyEveryChunk }) {
  assert(secret, 'secret is required')
  assert(Buffer.from(secret, 'base64').length >= 32, 'secret must be at least 32 bytes')
  const debug = Debug('ilp-psk2:listen')
  plugin = convertToV2Plugin(plugin)

  const payments = {}

  plugin.registerTransferHandler(handlePrepare)

  async function handlePrepare (transfer) {
    // TODO check that destination matches our address

    let decryptedData
    try {
      decryptedData = decrypt(secret, transfer.data)
    } catch (err) {
      debug('error decrypting data:', err)
      err.name = 'InterledgerRejectionError'
      err.ilpRejection = {
        code: 'F01',
        name: 'Invalid Packet',
        message: 'unable to decrypt data',
        triggeredAt: new Date(),
        triggeredBy: '',
        forwardedBy: []
      }
      throw err
    }

    const headersReader = new oer.Reader(decryptedData)
    const type = headersReader.readUInt8()
    let err
    if (type === TYPE_QUOTE) {
      debug('responding to quote request')
      err = new Error('quote response')
      err.name = 'InterledgerRejectionError'
      const responseWriter = new oer.Writer()
      const amountLong = Long.fromString(transfer.amount)
      responseWriter.writeUInt64([amountLong.high, amountLong.low])
      err.ilpRejection = {
        code: 'F99',
        name: 'Application Error',
        triggeredAt: new Date(),
        additionalInfo: {
          message: base64url(encrypt(secret, responseWriter.getBuffer()))
        },
        triggeredBy: '',
        forwardedBy: []
      }
      throw err
    } else if (type === TYPE_CHUNK || type === TYPE_LAST_CHUNK) {
      let fulfillment
      try {
        fulfillment = base64url(dataToFulfillment(secret, transfer.data, transfer.condition))
      } catch (err) {
        err = new Error('wrong condition')
        err.name = 'InterledgerRejectionError'
        err.ilpRejection = {
          code: 'F05',
          name: 'Wrong Condition',
          triggeredAt: new Date(),
          message: 'wrong condition',
          triggeredBy: '',
          forwardedBy: []
        }
        throw err
      }
      const lastChunk = (type === TYPE_LAST_CHUNK)
      const paymentId = headersReader.read(16)
      const destinationAmount = new BigNumber(new Long(headersReader.readUInt64()).toString())

      let record = payments[paymentId]
      if (!record) {
        record = payments[paymentId] = {
          received: new BigNumber(0),
          expected: MAX_UINT_64,
          finished: false
        }
      }
      if (destinationAmount.gt(0)) {
        record.expected = destinationAmount
      }

      // If too much arrived, respond with error saying how much we're waiting
      // for and how much came in on this transfer
      const received = record.received.plus(transfer.amount)
      // TODO make the acceptable overage amount configurable
      if (record.finished || received.gt(record.expected.times(1.01))) {
        debug(`receiver received too much. amount received before this chunk: ${record.received}, this chunk: ${transfer.amount}, expected: ${record.expected}`)
        err = new Error('too much arrived')
        err.name = 'InterledgerRejectionError'
        err.ilpRejection = {
          code: 'F99',
          name: 'Application Error',
          triggeredAt: new Date(),
          triggeredBy: '',
          forwardedBy: []
        }
        const responseWriter = new oer.Writer()
        const deltaLong = Long.fromString(record.delta.minus(record.received).toString(10))
        responseWriter.writeUInt64([deltaLong.getHighBitsUnsigned(), deltaLong.getLowBitsUnsigned()])
        const amountLong = Long.fromString(transfer.amount)
        responseWriter.writeUInt64([amountLong.getHighBitsUnsigned(), amountLong.getHighBitsUnsigned()])
        const response = responseWriter.getBuffer()
        err.ilpRejection.additionalInfo = {
          message: encrypt(secret, response)
        }
        throw err
      }

      debug(`got ${record.finished ? 'last ' : ''}chunk of amount ${transfer.amount} for payment: ${paymentId.toString('hex')}. total received: ${received}`)
      record.received = received
      record.finished = (lastChunk || received.gte(record.expected))

      // TODO accept user response data
      const response = Buffer.alloc(8, 0)
      const responseWriter = new oer.Writer()
      const receivedLong = Long.fromString(received.toString(10))
      responseWriter.writeUInt64([receivedLong.getHighBitsUnsigned(), receivedLong.getLowBitsUnsigned()])
      const data = encrypt(secret, responseWriter.getBuffer())

      return { fulfillment, data }

    } else {
      err = new Error('unexpected payment')
      err.ilpRejection = {
        code: 'F06',
        name: 'Unexpected Payment',
        triggeredAt: new Date(),
        triggeredBy: '',
        forwardedBy: []
      }
      throw err
    }
  }
}

function dataToFulfillment (secret, data, originalCondition) {
  const key = hmac(secret, PSK_FULFILLMENT_STRING)
  const fulfillment = hmac(key, data)
  const condition = hash(fulfillment)
  if (originalCondition && !condition.equals(Buffer.from(originalCondition, 'base64'))) {
    throw new Error('unable to regenerate fulfillment')
  }
  return fulfillment
}

function getNonce () {
  return crypto.randomBytes(NONCE_LENGTH)
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', Buffer.from(key, 'base64'))
  h.update(Buffer.from(message, 'utf8'))
  return h.digest()
}

function hash (preimage) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(preimage, 'base64'))
  return h.digest()
}

function encrypt (secret, data) {
  const buffer = Buffer.from(data, 'base64')
  const nonce = getNonce()
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)

  const encryptedInitial = cipher.update(buffer)
  const encryptedFinal = cipher.final()
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    nonce,
    tag,
    encryptedInitial,
    encryptedFinal
  ])
}

function decrypt (secret, data) {
  const buffer = Buffer.from(data, 'base64')
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const nonce = buffer.slice(0, NONCE_LENGTH)
  const tag = buffer.slice(NONCE_LENGTH, NONCE_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buffer.slice(NONCE_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])
}

// oer-utils returns [high, low], whereas Long expects low first
function highLowToBigNumber (highLow) {
  // TODO use a more efficient method to convert this
  const long = Long.fromBits(highLow[1], highLow[0])
  return new BigNumber(long.toString(10))
}

exports.quote = quote
exports.send = send
exports.deliver = deliver
exports.listen = listen
