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

  const quoteId = crypto.randomBytes(16)
  const data = serializePskPacket({
    sharedSecret,
    type: TYPE_LAST_CHUNK,
    paymentId: quoteId,
    sequence: 0,
    paymentAmount: MAX_UINT64,
    chunkAmount: MAX_UINT64,
  })
  const ilp = IlpPacket.serializeIlpForwardedPayment({
    account: destination,
    data
  })

  const amount = sourceAmount || STARTING_TRANSFER_AMOUNT
  const transfer = {
    amount,
    executionCondition: crypto.randomBytes(32),
    expiresAt: new Date(Date.now() + DEFAULT_TRANSFER_TIMEOUT).toISOString(),
    ilp
  }

  try {
    await plugin.sendTransfer(transfer)
  } catch (err) {
    if (!err.ilpRejection) {
      throw err
    }

    debug(`got quote response:`, err.ilpRejection)

    let amountArrived
    try {
      const rejection = IlpPacket.deserializeIlpRejection(err.ilpRejection)
      const quoteResponse = deserializePskPacket(sharedSecret, rejection.data)

      // Validate that this is actually the response to our request
      assert(quoteResponse.type === TYPE_ERROR, 'response type must be error')
      assert(quoteId.equals(quoteResponse.paymentId), 'response Payment ID does not match outgoing quote')

      amountArrived = quoteResponse.chunkAmount
    } catch (decryptionErr) {
      debug('error parsing encrypted quote response', decryptionErr)
      throw err
    }

    debug(`receiver got: ${amountArrived.toString(10)} when sender sent: ${amount} (rate: ${amountArrived.div(amount).toString(10)})`)
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
// TODO accept user data also
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
  let rate = new BigNumber(0)

  function handleReceiverResponse ({ encrypted, expectedType, expectedSequence }) {
    try {
      const response = deserializePskPacket(secret, encrypted)

      assert(expectedType === response.type, `unexpected packet type. expected: ${expectedType}, actual: ${response.type}`)
      assert(paymentId.equals(response.paymentId), `response does not correspond to request. payment id does not match. actual: ${response.paymentId.toString('hex')}, expected: ${paymentId.toString('hex')}`)
      assert(expectedSequence === response.sequence, `response does not correspond to request. sequence does not match. actual: ${response.sequence}, expected: ${sequence - 1}`)

      const amountReceived = response.paymentAmount
      debug(`receiver says they have received: ${amountReceived.toString(10)}`)
      if (amountReceived.gt(amountDelivered)) {
        amountDelivered = amountReceived
        rate = amountDelivered.div(amountSent)
      } else {
        // TODO should we throw a more serious error here?
        debug(`receiver decreased the amount they say they received. previously: ${amountDelivered.toString(10)}, now: ${amountReceived.toString(10)}`)
      }
    } catch (err) {
      debug('error decrypting response data:', err, encrypted.toString('base64'))
      throw new Error('Got bad response from receiver: ' + err.message)
    }
  }

  while (true) {
    // Figure out if we've sent enough already
    let amountLeftToSend
    if (sourceAmount) {
      // Fixed source amount
      amountLeftToSend = new BigNumber(sourceAmount).minus(amountSent)
      debug(`amount left to send: ${amountLeftToSend.toString(10)}`)
    } else {
      // Fixed destination amount
      const amountLeftToDeliver = new BigNumber(destinationAmount).minus(amountDelivered)
      if (amountLeftToDeliver.lte(0)) {
        debug('amount left to deliver: 0')
        break
      }
      // Use the path exchange rate to figure out the amount left to send
      if (amountSent.gt(0)) {
        const rate = amountDelivered.div(amountSent)
        amountLeftToSend = amountLeftToDeliver.div(rate).round(0, BigNumber.ROUND_CEIL) // round up
        debug(`amount left to send: ${amountLeftToSend.toString(10)} (amount left to deliver: ${amountLeftToDeliver.toString(10)}, rate: ${rate.toString(10)})`)
      } else {
        // We don't know how much more we need to send
        amountLeftToSend = MAX_UINT64
        debug('amount left to send: unknown')
      }
    }

    // Stop if we've already sent enough
    if (amountLeftToSend.lte(0)) {
      break
    }

    // If there's only one more chunk to send, communicate that to the receiver
    if (amountLeftToSend.lte(chunkSize)) {
      debug('sending last chunk')
      chunkSize = amountLeftToSend
      lastChunk = true
    }

    // TODO should we allow the rate to fluctuate more?
    const minimumAmountReceiverShouldAccept = rate.times(chunkSize)

    const data = serializePskPacket({
      sharedSecret,
      type: (lastChunk ? TYPE_LAST_CHUNK : TYPE_CHUNK),
      paymentId,
      sequence,
      paymentAmount: (destinationAmount ? new BigNumber(destinationAmount) : MAX_UINT64),
      chunkAmount: minimumAmountReceiverShouldAccept
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

      handleReceiverResponse({
        encrypted: result.ilp,
        expectedType: TYPE_FULFILLMENT,
        expectedSequence: sequence
      })

      chunkSize = chunkSize.times(TRANSFER_INCREASE).round(0)
      debug('transfer was successful, increasing chunk size to:', chunkSize.toString(10))
      timeToWait = 0

      if (lastChunk) {
        break
      } else {
        sequence++
      }
    } catch (err) {
      if (err.name !== 'InterledgerRejectionError' || !err.ilpRejection) {
        debug('got error other than an InterledgerRejectionError:', err)
        throw err
      }

      let ilpRejection
      try {
        ilpRejection = IlpPacket.deserializeIlpRejection(err.ilpRejection)
      } catch (err) {
        debug('error parsing IlpRejection from receiver:', err && err.stack)
        throw new Error('Error parsing IlpRejection from receiver: ' + err.message)
      }

      if (ilpRejection.code === 'F99') {
        // Handle if the receiver rejects the transfer with a PSK packet
        handleReceiverResponse({
          encrypted: ilpRejection.data,
          expectedType: TYPE_ERROR,
          expectedSequence: sequence
        })
      } else if (ilpRejection.code[0] === 'T' || ilpRejection.code[0] === 'R') {
        // Handle temporary and relative errors
        // TODO is this the right behavior in this situation?
        // TODO don't retry forever
        chunkSize = chunkSize
          .times(TRANSFER_DECREASE)
          .round(0)
        if (chunkSize.lt(1)) {
          chunkSize = new BigNumber(1)
        }
        timeToWait = Math.max(timeToWait * 2, 100)
        debug(`got temporary ILP rejection: ${ilpRejection.code}, reducing chunk size to: ${chunkSize.toString(10)} and waiting: ${timeToWait}ms`)
        await new Promise((resolve, reject) => setTimeout(resolve, timeToWait))
      } else {
        // TODO is it ever worth retrying here?
        debug('got ILP rejection with final error:', JSON.stringify(ilpRejection))
        throw new Error(`Transfer rejected with final error: ${ilpRejection.code}${(ilpRejection.message ? ': ' + ilpRejection.message : '')}`)
      }
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

    // TODO use a different shared secret for each sender
    const sharedSecret = secret

    let packet
    let request
    let err
    try {
      packet = IlpPacket.deserializeIlpForwardedPayment(transfer.ilp)
      request = deserializePskPacket(secret, packet.data)
    } catch (err) {
      debug('error decrypting data:', err)
      err = new Error('unable to decrypt data')
      err.name = 'InterledgerRejectionError'
      err.ilp = IlpPacket.serializeIlpRejection({
        code: 'F01',
        message: 'unable to decrypt data',
        data: Buffer.alloc(0),
        triggeredBy: ''
      })
      throw err
    }

    if (request.type !== TYPE_CHUNK && request.type !== TYPE_LAST_CHUNK) {
      // TODO should this return an encrypted response
      debug(`got unexpected request type: ${request.type}`)
      err = new Error(`unexpected request type: ${request.type}`)
      err.name = 'InterledgerRejectionError'
      err.ilpRejection = IlpPacket.serializeIlpRejection({
        code: 'F06',
        message: 'wrong type',
        data: Buffer.alloc(0),
        triggeredBy: ''
      })
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
      err.ilpRejection = IlpPacket.serializeIlpRejection({
        code: 'F99',
        triggeredBy: '',
        message: '',
        data
      })
      throw err
    }

    // Transfer amount too low
    if (request.chunkAmount.gt(transfer.amount)) {
      return rejectTransfer(`incoming transfer amount too low. actual: ${transfer.amount}, expected: ${request.chunkAmount.toString(10)}`)
    }

    // Already received enough
    if (record.received.gte(record.expected)) {
      return rejectTransfer(`already received enough for payment. received: ${record.received.toString(10)}, expected: ${record.expected.toString(10)}`)
    }

    // Chunk is too much
    if (record.received.plus(transfer.amount).gt(record.expected.times(acceptableOverpaymentMultiple))) {
      return rejectTransfer(`incoming transfer would put the payment too far over the expected amount. already received: ${record.received.toString(10)}, expected: ${record.expected.toString(10)}, transfer amount: ${transfer.amount}`)
    }

    // Check if we can regenerate the correct fulfillment
    let fulfillment
    try {
      fulfillment = dataToFulfillment(secret, packet.data, transfer.executionCondition)
    } catch (err) {
      err = new Error('wrong condition')
      err.name = 'InterledgerRejectionError'
      err.ilpRejection = IlpPacket.serializeIlpRejection({
        code: 'F05',
        message: 'wrong condition',
        data: Buffer.alloc(0),
        triggeredBy: ''
      })
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

    debug(`got ${record.finished ? 'last ' : ''}chunk of amount ${transfer.amount} for payment: ${paymentId}. total received: ${record.received.toString(10)}`)

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
  assert(Buffer.isBuffer(applicationData), 'applicationData must be a buffer')
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
  if (originalCondition) {
    const condition = hash(fulfillment)
    if (!condition.equals(Buffer.from(originalCondition, 'base64'))) {
      throw new Error('unable to regenerate fulfillment')
    }
    console.log('xx condition matches', fulfillment.toString('base64'), condition.toString('base64'), Buffer.from(originalCondition || '', 'base64').toString('base64'))
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
  const long = Long.fromBits(highLow[1], highLow[0], true)
  return new BigNumber(long.toString(10))
}

function bigNumberToHighLow (bignum) {
  const long = Long.fromString(bignum.toString(10), true)
  return [long.getHighBitsUnsigned(), long.getLowBitsUnsigned()]
}

exports.quote = quote
exports.send = send
exports.deliver = deliver
exports.listen = listen
