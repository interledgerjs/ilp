'use strict'

const crypto = require('crypto')
const stringify = require('canonical-json')

const IPR_RECEIVER_ID_STRING = 'ilp_ipr_receiver_id'
const IPR_CONDITION_STRING = 'ilp_ipr_condition'
const PSK_GENERATION_STRING = 'ilp_psk_generation'
const PSK_CONDITION_STRING = 'ilp_psk_condition'
const PSK_ENCRYPTION_STRING = 'ilp_key_encryption'

const PSK_DH_STRING = 'ilp_psk_diffie_hellman'

function createHmacHelper (hmacKey) {
  if (!hmacKey) {
    hmacKey = crypto.randomBytes(32)
  }

  const iprConditionKey = hmac(hmacKey, IPR_CONDITION_STRING)
  function hmacJsonForIprCondition (obj) {
    const jsonString = stringify(obj)
    return hmac(iprConditionKey, jsonString)
  }

  function getReceiverId () {
    return hmac(hmacKey, IPR_RECEIVER_ID_STRING).slice(0, 8)
  }

  function getPskToken () {
    return crypto.randomBytes(16)
  }

  function getPskSharedSecret (token) {
    const generator = hmac(hmacKey, PSK_GENERATION_STRING)
    return hmac(generator, token).slice(0, 16)
  }

  function getPskDhSharedSecret (publicKey, suppliedPrivateKey) {
    const privateKey = suppliedPrivateKey || hmac(hmacKey, PSK_DH_STRING)
    const dh = crypto.createECDH('secp256k1')
    dh.setPrivateKey(privateKey)
    return dh.computeSecret(publicKey)
  }

  function getPskDhPublicKey (suppliedPrivateKey) {
    const privateKey = suppliedPrivateKey || hmac(hmacKey, PSK_DH_STRING)
    const dh = crypto.createECDH('secp256k1')
    dh.setPrivateKey(privateKey)
    return dh.getPublicKey()
  }

  return {
    hmacJsonForIprCondition,
    getReceiverId,
    getPskToken,
    getPskSharedSecret,
    hmacJsonForPskCondition,
    aesDecryptObject,
    aesEncryptObject,
    getPskDhPublicKey,
    getPskDhSharedSecret
  }
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message, 'utf8')
  return h.digest()
}

function hmacJsonForPskCondition (obj, sharedSecret) {
  console.log('hmac', sharedSecret.toString('base64'), JSON.stringify(obj))
  const pskConditionKey = hmac(sharedSecret, PSK_CONDITION_STRING)
  const jsonString = stringify(obj)
  const hmacDigest = hmac(pskConditionKey, jsonString)
  return hmacDigest
}

// turn object into encrypted buffer
function aesEncryptObject (obj, sharedSecret) {
  const pskEncryptionKey = hmac(sharedSecret, PSK_ENCRYPTION_STRING)
  const cipher = crypto.createCipher('aes-256-ctr', pskEncryptionKey)

  return Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(obj), 'utf-8')),
    cipher.final()
  ])
}

// turn base64-encoded encrypted text into parsed object
function aesDecryptObject (encrypted, sharedSecret) {
  const pskEncryptionKey = hmac(sharedSecret, PSK_ENCRYPTION_STRING)
  const decipher = crypto.createDecipher('aes-256-ctr', pskEncryptionKey)

  const decoded = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])

  try {
    return JSON.parse(decoded.toString('utf8'))
  } catch (e) {
    throw new Error('Corrupted ciphertext: ' + e.message)
  }
}

module.exports = {
  createHmacHelper,
  hmacJsonForPskCondition,
  aesEncryptObject,
  aesDecryptObject
}
