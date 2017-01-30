'use strict'

const crypto = require('crypto')
const stringify = require('canonical-json')

const IPR_RECEIVER_ID_STRING = 'ilp_ipr_receiver_id'
const IPR_CONDITION_STRING = 'ilp_ipr_condition'
const SSP_GENERATION_STRING = 'ilp_ssp_generation'
const SSP_CONDITION_STRING = 'ilp_ssp_condition'

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

  function getSspToken () {
    return crypto.randomBytes(16)
  }

  function getSspSharedSecret (token) {
    const generator = hmac(hmacKey, SSP_GENERATION_STRING)
    return hmac(generator, token).slice(0, 16)
  }

  function hmacJsonForSspCondition (obj, sharedSecret) {
    const sspConditionKey = hmac(sharedSecret, SSP_CONDITION_STRING)
    const jsonString = stringify(obj)
    const hmacDigest = hmac(sspConditionKey, jsonString)
    return hmacDigest
  }

  return {
    hmacJsonForIprCondition,
    getReceiverId,
    getSspToken,
    getSspSharedSecret,
    hmacJsonForSspCondition
  }
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message, 'utf8')
  return h.digest()
}

exports.createHmacHelper = createHmacHelper
