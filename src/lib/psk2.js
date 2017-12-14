'use strict'

const assert = require('assert')
const crypto = require('crypto')
const Debug = require('debug')
const BigNumber = require('bignumber.js')
const oer = require('oer-utils')
const Long = require('long')
const IlpPacket = require('ilp-packet')
const convertToV2Plugin = require('ilp-compat-plugin')

const PSK_FULFILLMENT_STRING = 'ilp_psk2_fulfillment'
const PSK_ENCRYPTION_STRING = 'ilp_psk2_encryption'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const NULL_CONDITION_BUFFER = Buffer.alloc(32, 0)
const DEFAULT_TRANSFER_TIMEOUT = 2000
const STARTING_TRANSFER_AMOUNT = 1000
const TRANSFER_INCREASE = 1.1
const TRANSFER_DECREASE = 0.5

const MAX_UINT8 = 255
const MAX_UINT32 = 4294967295
const MAX_UINT64 = new BigNumber('18446744073709551615')

const TYPE_CHUNK = 0
const TYPE_LAST_CHUNK = 1
const TYPE_FULFILLMENT = 2
const TYPE_ERROR = 3

async function quote (plugin, {
  sourceAmount,
  destinationAmount,
  sharedSecret,
  destination
}) {
  plugin = convertToV2Plugin(plugin)
  const debug = Debug('ilp-psk2:quote')
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(sourceAmount || destinationAmount, 'either sourceAmount or destinationAmount is required')
  assert(!sourceAmount || !destinationAmount, 'cannot supply both sourceAmount and destinationAmount')

  debug(`sending transfer with source amount: ${amount}`)

  const quoteId = crypto.randomBytes(16)
  const data = serializePskPacket({
    sharedSecret,
    type: TYPE_LAST_CHUNK,
    paymentId: quoteId,
    sequence: 0,
    paymentAmount: new BigNumber(0),
    chunkAmount: MAX_UINT64,
  })
  const ilp = IlpPacket.serializeIlpForwardedPayment({
    account: destination,
    data
  })

  const transfer = {
    amount: sourceAmount || STARTING_TRANSFER_AMOUNT,
    executionCondition: crypto.randomBytes(32),
    expiresAt: new Date(Date.now() + DEFAULT_TRANSFER_TIMEOUT).toISOString(),
    ilp
  }

  try {
    await plugin.sendTransfer(transfer)
  } catch (err) {
    if (!err.ilpRejection || err.ilpRejection.code !== 'F99') {
      throw err
    }

    debug(`got quote response:`, err.ilpRejection)

    let amountArrived
    try {
      let additionalInfo = err.ilpRejection.additionalInfo
      if (typeof additionalInfo === 'string') {
        additionalInfo = JSON.parse(additionalInfo)
      }
      const errorData = additionalInfo.message
      const quoteResponse = deserializePskPacket(sharedSecret, errorData)

      // Validate that this is actually the response to our request
      assert(quoteResponse.type === TYPE_ERROR, 'response type must be error')
      assert(quoteId.equals(quoteResponse.paymentId), 'response Payment ID does not match outgoing quote')

      amountArrived = quoteResponse.chunkAmount
    } catch (decryptionErr) {
      debug('error parsing encrypted quote response', decryptionErr)
      throw err
    }

    debug(`receiver got: ${amountArrived.toString(10)} when sender sent: ${amount}`)
    if (sourceAmount) {
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
  }
}

async function send (plugin, {
  sourceAmount,
  sharedSecret,
  destination
}) {
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(sourceAmount, 'sourceAmount is required')
  return sendChunkedPayment(plugin, { sourceAmount, sharedSecret, destination })
}

async function deliver (plugin, {
  destinationAmount,
  sharedSecret,
  destination,
}) {
  assert(sharedSecret, 'sharedSecret is required')
  assert(Buffer.from(sharedSecret, 'base64').length >= 32, 'sharedSecret must be at least 32 bytes')
  assert(destinationAmount, 'destinationAmount is required')
  return sendChunkedPayment(plugin, { destinationAmount, sharedSecret, destination })
}

// TODO add option not to chunk the payment
async function sendChunkedPayment (plugin, {
  sharedSecret,
  destination,
  sourceAmount,
  destinationAmount,
}) {
  plugin = convertToV2Plugin(plugin)
  const debug = Debug('ilp-psk2:chunkedPayment')
  const secret = Buffer.from(sharedSecret, 'base64')
  const paymentId = crypto.randomBytes(16)

  let amountSent = new BigNumber(0)
  let amountDelivered = new BigNumber(0)
  let sequence = 0
  let chunkSize = new BigNumber(STARTING_TRANSFER_AMOUNT)
  let lastChunk = false
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
        amountLeftToSend = MAX_UINT64
      }
    }

    if (amountLeftToSend.lte(0)) {
      break
    } else if (amountLeftToSend.lte(chunkSize)) {
      debug('sending last chunk')
      chunkSize = amountLeftToSend
      lastChunk = true
    }

    // TODO accept user data also
    const data = serializePskPacket({
      sharedSecret,
      type: (lastChunk ? TYPE_LAST_CHUNK : TYPE_CHUNK),
      paymentId,
      sequence,
      paymentAmount: (destinationAmount ? new BigNumber(destinationAmount) : MAX_UINT64),
      chunkAmount: chunkSize
    })
    const ilp = IlpPacket.serializeIlpForwardedPayment({
      account: destination,
      data
    })

    const fulfillment = dataToFulfillment(secret, data)
    const executionCondition = hash(fulfillment)

    debug(`sending chunk of: ${chunkSize.toString(10)}`)
    const transfer = {
      ilp,
      amount: chunkSize.toString(10),
      expiresAt: new Date(Date.now() + DEFAULT_TRANSFER_TIMEOUT).toISOString(),
      executionCondition
    }

    try {
      const result = await plugin.sendTransfer(transfer)
      amountSent = amountSent.plus(transfer.amount)
      sequence++
      chunkSize = chunkSize.times(TRANSFER_INCREASE).round(0)
      debug('transfer was successful, increasing chunk size to:', chunkSize.toString(10))
      timeToWait = 0

      // Parse receiver's response
      try {
        const response = deserializePskPacket(secret, result.data)

        assert(TYPE_FULFILLMENT === response.type, `response is not a fulfillment response packet, got type: ${response.type}`)
        assert(paymentId.equals(response.paymentId), `response does not correspond to request. payment id does not match. actual: ${response.paymentId.toString('hex')}, expected: ${paymentId.toString('hex')}`)
        // uses sequence - 1 because we've already called sequence++ above
        assert(sequence - 1 === response.sequence, `response does not correspond to request. sequence does not match. actual: ${response.sequence}, expected: ${sequence - 1}`)

        const amountReceived = response.paymentAmount
        debug(`receiver says they have received: ${amountReceived.toString(10)}`)
        if (amountReceived.gt(amountDelivered)) {
          amountDelivered = amountReceived
        } else {
          // TODO should we throw a more serious error here?
          debug(`receiver decreased the amount they say they received. previously: ${amountDelivered.toString(10)}, now: ${amountReceived.toString(10)}`)
        }
      } catch (err) {
        // TODO update amount delivered somehow so not getting the response back
        // doesn't affect our view of the exchange rate
        debug('error decrypting response data:', err, result)
        continue
      }
    } catch (err) {
      // TODO handle specific receiver errors
      debug('got error sending payment chunk:', err)
      chunkSize = chunkSize.times(TRANSFER_DECREASE).round(0)
      if (chunkSize.lt(1)) {
        chunkSize = new BigNumber(1)
      }
      timeToWait = Math.max(timeToWait * 2, 100)
      await new Promise((resolve, reject) => setTimeout(resolve, timeToWait))
    }
  }

  debug(`sent payment. source amount: ${amountSent.toString(10)}, destination amount: ${amountDelivered.toString(10)}, number of chunks: ${sequence + 1}`)

  return {
    sourceAmount: amountSent.toString(10),
    destinationAmount: amountDelivered.toString(10),
    numChunks: sequence + 1
  }
}

function listen (plugin, {
  secret,
  notifyEveryChunk,
  acceptableOverpaymentMultiple = 1.01
}) {
  assert(secret, 'secret is required')
  assert(Buffer.from(secret, 'base64').length >= 32, 'secret must be at least 32 bytes')
  const debug = Debug('ilp-psk2:listen')
  plugin = convertToV2Plugin(plugin)

  const payments = {}

  plugin.registerTransferHandler(handlePrepare)

  async function handlePrepare (transfer) {
    // TODO check that destination matches our address

    let request
    let err
    try {
      request = deserializePskPacket(secret, transfer.data)
    } catch (err) {
      debug('error decrypting data:', err)
      err = new Error('unable to decrypt data')
      err.name = 'InterledgerRejectionError'
      err.ilp = IlpPacket.serializeIlpError({
        code: 'F01',
        name: 'Invalid Packet',
        data: 'unable to decrypt data',
        triggeredAt: new Date(),
        triggeredBy: '',
        forwardedBy: []
      })
      throw err
    }

    if (request.type !== TYPE_CHUNK && request.type !== TYPE_LAST_CHUNK) {
      // TODO should this return an encrypted response
      debug(`got unexpected request type: ${request.type}`)
      err = new Error(`unexpected request type: ${request.type}`)
      err.name = 'InterledgerRejectionError'
      err.ilpRejection = {
        code: 'F06',
        name: 'Unexpected Payment',
        message: 'wrong type',
        triggeredAt: new Date(),
        triggeredBy: '',
        forwardedBy: []
      }
      throw err
    }

    const paymentId = request.paymentId.toString('hex')
    let record = payments[paymentId]
    if (!record) {
      record = {
        // TODO buffer user data and keep track of sequence numbers
        received: new BigNumber(0),
        expected: new BigNumber(0),
        finished: false
      }
      payments[paymentId] = record
    }
    record.expected = request.paymentAmount

    function rejectTransfer (message) {
      debug(`rejecting transfer ${transfer.id} (part of payment: ${paymentId}): ${message}`)
      err = new Error(message)
      err.name = 'InterledgerRejectionError'
      const data = serializePskPacket({
        sharedSecret,
        type: TYPE_ERROR,
        paymentId: request.paymentId,
        sequence: request.sequence,
        paymentAmount: record.received,
        chunkAmount: new BigNumber(transfer.amount)
      })
      err.ilp = IlpPacket.serializeIlpError({
        code: 'F99',
        name: 'Application Error',
        triggeredBy: '',
        forwardedBy: [],
        triggeredAt: new Date(),
        data: data.toString('base64')
      })
      throw err
    }

    // Transfer amount too low
    if (request.chunkAmount.lt(transfer.amount)) {
      return rejectTransfer(`incoming transfer amount too low. actual: ${transfer.amount}, expected: ${request.chunkAmount.toString(10)}`)
    }

    // Already received enough
    if (record.received.gte(expected)) {
      return rejectTransfer(`already received enough for payment. received: ${record.received.toString(10)}, expected: ${record.expected.toString(10)}`)
    }

    // Chunk is too much
    if (record.received.plus(transfer.amount).gt(record.expected.times(acceptableOverpaymentMultiple))) {
      return rejectTransfer(`incoming transfer would put the payment too far over the expected amount. already received: ${record.received.toString(10)}, expected: ${record.expected.toString(10)}, transfer amount: ${transfer.amount}`)
    }

    // Check if we can regenerate the correct fulfillment
    let fulfillment
    try {
      fulfillment = dataToFulfillment(secret, transfer.data, transfer.condition)
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

    // Update stats based on that chunk
    record.received = record.received.plus(transfer.amount)
    if (record.received.gte(record.expected) || request.type === TYPE_LAST_CHUNK) {
      record.finished = true
    }

    const response = serializePskPacket({
      sharedSecret: secret,
      type: TYPE_FULFILLMENT,
      paymentId: request.paymentId,
      sequence: request.sequence,
      paymentAmount: record.received,
      chunkAmount: new BigNumber(transfer.amount)
    })

    debug(`got ${record.finished ? 'last ' : ''}chunk of amount ${transfer.amount} for payment: ${paymentId}. total received: ${received}`)

    return {
      fulfillment,
      ilp: response
    }
  }
}

function serializePskPacket ({
  sharedSecret,
  type,
  paymentId,
  sequence,
  paymentAmount,
  chunkAmount,
  applicationData = Buffer.alloc(0),
  includeJunkData = true
}) {
  assert(Number.isInteger(type) && type < 256, 'type must be a UInt8')
  assert(Buffer.isBuffer(paymentId) && paymentId.length === 16, 'paymentId must be a 16-byte buffer')
  assert(Number.isInteger(sequence) && sequence <= MAX_UINT32, 'sequence must be a UInt32')
  assert(paymentAmount instanceof BigNumber && paymentAmount.lte(MAX_UINT64), 'paymentAmount must be a UInt64')
  assert(chunkAmount instanceof BigNumber && chunkAmount.lte(MAX_UINT64), 'chunkAmount must be a UInt64')
  assert(Buffer.isBuffer(applicationData) && applicationData.length <= MAX_APPLICATION_DATA, 'applicationData must be a buffer and must not exceed ' + MAX_APPLICATION_DATA + ' bytes')
  const writer = new oer.Writer()
  writer.writeUInt8(type)
  writer.writeOctetString(paymentId, 16)
  writer.writeUInt32(sequence)
  writer.writeUInt64(bigNumberToHighLow(paymentAmount))
  writer.writeUInt64(bigNumberToHighLow(chunkAmount))
  writer.writeVarOctetString(applicationData)
  writer.writeUInt8(0) // OER extensibility
  const contents = writer.getBuffer()

  // TODO add junk data

  const ciphertext = encrypt(sharedSecret, contents)
  return ciphertext
}

function deserializePskPacket (sharedSecret, ciphertext) {
  const contents = decrypt(sharedSecret, ciphertext)
  const reader = new oer.Reader(contents)

  return {
    type: reader.readUInt8(),
    paymentId: reader.readOctetString(16),
    sequence: reader.readUInt32(),
    paymentAmount: highLowToBigNumber(reader.readUInt64()),
    chunkAmount: highLowToBigNumber(reader.readUInt64()),
    applicationData: reader.readVarOctetString()
  }
}

function encrypt (secret, data) {
  const buffer = Buffer.from(data, 'base64')
  const iv = crypto.randomBytes(IV_LENGTH)
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, iv)

  const encryptedInitial = cipher.update(buffer)
  const encryptedFinal = cipher.final()
  const tag = cipher.getAuthTag()
  return Buffer.concat([
    iv,
    tag,
    encryptedInitial,
    encryptedFinal
  ])
}

function decrypt (secret, data) {
  const buffer = Buffer.from(data, 'base64')
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const nonce = buffer.slice(0, IV_LENGTH)
  const tag = buffer.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buffer.slice(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])
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

// oer-utils returns [high, low], whereas Long expects low first
function highLowToBigNumber (highLow) {
  // TODO use a more efficient method to convert this
  const long = Long.fromBits(highLow[1], highLow[0])
  return new BigNumber(long.toString(10))
}

function bigNumberToHighLow (bignum) {
  const long = Long.fromString(bignum.toString(10))
  return [long[1], long[0]]
}

exports.quote = quote
exports.send = send
exports.deliver = deliver
exports.listen = listen
