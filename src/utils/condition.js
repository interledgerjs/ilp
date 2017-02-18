'use strict'

const crypto = require('crypto')
const base64url = require('./base64url')

function toConditionUri (conditionPreimage) {
  if (conditionPreimage.length !== 32) {
    throw new Error('Condition preimage must be 32 bytes')
  }
  const hash = crypto.createHash('sha256')
  hash.update(conditionPreimage)
  const condition = hash.digest()
  const conditionUri = 'ni:///sha-256;' + base64url(condition) + '?fpt=preimage-sha-256&cost=32'
  return conditionUri
}

// DER encoding prefix (specific to 32-byte preimages)
const PREIMAGE_32BYTE_PREAMBLE = Buffer.from([0xa0, 0x22, 0x80, 0x20])
function toFulfillmentUri (conditionPreimage) {
  if (conditionPreimage.length !== 32) {
    throw new Error('Condition preimage must be 32 bytes')
  }
  const fulfillment = Buffer.concat([PREIMAGE_32BYTE_PREAMBLE, conditionPreimage])
  const fulfillmentUri = base64url(fulfillment)
  return fulfillmentUri
}

Object.assign(exports, {
  toConditionUri,
  toFulfillmentUri
})
