'use strict'

const crypto = require('crypto')
const base64url = require('./base64url')

const IPR_RECEIVER_ID_STRING = 'ilp_psk_receiver_id'
const PSK_GENERATION_STRING = 'ilp_psk_generation'
const PSK_CONDITION_STRING = 'ilp_psk_condition'
const PSK_ENCRYPTION_STRING = 'ilp_key_encryption'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const RECEIVER_ID_LENGTH = 8
const SHARED_SECRET_LENGTH = 16
const PSK_TOKEN_LENGTH = 16

function getPskToken () {
  return crypto.randomBytes(PSK_TOKEN_LENGTH)
}

function getReceiverId (hmacKey) {
  return hmac(hmacKey, IPR_RECEIVER_ID_STRING).slice(0, RECEIVER_ID_LENGTH)
}

function getPskSharedSecret (hmacKey, token) {
  const generator = hmac(hmacKey, PSK_GENERATION_STRING)
  return hmac(generator, token).slice(0, SHARED_SECRET_LENGTH)
}

function generatePskParams (receiverSecret) {
  const token = getPskToken()
  const sharedSecret = getPskSharedSecret(receiverSecret, token)
  const receiverId = getReceiverId(receiverSecret)

  return {
    token: base64url(token),
    receiverId: base64url(receiverId),
    sharedSecret: base64url(sharedSecret)
  }
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message, 'utf8')
  return h.digest()
}

function packetToPreimage (packet, sharedSecret) {
  const pskConditionKey = hmac(sharedSecret, PSK_CONDITION_STRING)
  const hmacDigest = hmac(pskConditionKey, Buffer.from(packet, 'base64'))
  return hmacDigest
}

// turn buffer into encrypted buffer
function aesEncryptBuffer ({ secret, nonce, buffer }) {
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const cipher =
    crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)

  const content = Buffer.concat([
    cipher.update(buffer),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()

  return { content, tag }
}

// turn buffer into decrypted buffer
function aesDecryptBuffer ({ secret, nonce, tag, buffer }) {
  const pskEncryptionKey = hmac(secret, PSK_ENCRYPTION_STRING)
  const decipher =
    crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  const content = Buffer.concat([
    decipher.update(buffer),
    decipher.final()
  ])

  return { content }
}

function preimageToCondition (conditionPreimage) {
  const hash = crypto.createHash('sha256')
  hash.update(conditionPreimage)
  const condition = hash.digest()
  return base64url(condition)
}

function packetToCondition (secret, packet) {
  return preimageToCondition(packetToPreimage(packet, secret))
}

function preimageToFulfillment (conditionPreimage) {
  return base64url(conditionPreimage)
}

module.exports = {
  ENCRYPTION_ALGORITHM,
  packetToPreimage,
  packetToCondition,
  generatePskParams,
  preimageToCondition,
  preimageToFulfillment,
  aesEncryptBuffer,
  aesDecryptBuffer,
  getPskToken,
  getReceiverId,
  getPskSharedSecret
}
