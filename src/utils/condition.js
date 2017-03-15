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
  const conditionUri = base64url(condition)
  return `cc:0:3:${conditionUri}:32`
}

function toFulfillmentUri (conditionPreimage) {
  if (conditionPreimage.length !== 32) {
    throw new Error('Condition preimage must be 32 bytes')
  }
  return `cf:0:${base64url(conditionPreimage)}`
}

Object.assign(exports, {
  toConditionUri,
  toFulfillmentUri
})
