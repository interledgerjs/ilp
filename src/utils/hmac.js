'use strict'

const crypto = require('crypto')
const stringify = require('canonical-json')

const IPR_RECEIVER_ID_STRING = 'ilp_ipr_receiver_id'
const IPR_CONDITION_STRING = 'ilp_ipr_condition'
const KEP_GENERATION_STRING = 'ilp_kep_generation'
const KEP_CONDITION_STRING = 'ilp_kep_condition'

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

  function getKepToken () {
    return crypto.randomBytes(16)
  }

  function getKepSharedSecret (token) {
    const generator = hmac(hmacKey, KEP_GENERATION_STRING)
    return hmac(generator, token).slice(0, 16)
  }

  function hmacJsonForKepCondition (obj, sharedSecret) {
    const kepConditionKey = hmac(sharedSecret, KEP_CONDITION_STRING)
    const jsonString = stringify(obj)
    const hmacDigest = hmac(kepConditionKey, jsonString)
    return hmacDigest
  }

  return {
    hmacJsonForIprCondition,
    getReceiverId,
    getKepToken,
    getKepSharedSecret,
    hmacJsonForKepCondition
  }
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message, 'utf8')
  return h.digest()
}

exports.createHmacHelper = createHmacHelper
