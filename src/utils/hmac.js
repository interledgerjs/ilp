'use strict'

const crypto = require('crypto')
const stringify = require('canonical-json')

const IPR_RECEIVER_ID_STRING = 'ilp_ipr_receiver_id'
const IPR_CONDITION_STRING = 'ilp_ipr_condition'

function createHmacHelper (hmacKey) {
  if (!hmacKey) {
    hmacKey = crypto.randomBytes(32)
  }

  const iprConditionKey = hmac(hmacKey, IPR_CONDITION_STRING)
  function hmacJsonForIprCondition (obj) {
    const jsonString = stringify(obj)
    return hmac(iprConditionKey, jsonString)
  }

  function getIprReceiverId () {
    return hmac(hmacKey, IPR_RECEIVER_ID_STRING).slice(0, 8)
  }

  return {
    hmacJsonForIprCondition,
    getIprReceiverId
  }
}

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message, 'utf8')
  return h.digest()
}

exports.createHmacHelper = createHmacHelper

