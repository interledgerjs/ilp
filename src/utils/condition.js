'use strict'

const crypto = require('crypto')
const base64url = require('./base64url')

function toConditionUri (conditionPreimage) {
  const hash = crypto.createHash('sha256')
  hash.update(conditionPreimage)
  const condition = hash.digest()
  const conditionUri = 'cc:0:3:' + base64url(condition) + ':32'
  return conditionUri
}

function toFulfillmentUri (conditionPreimage) {
  const fulfillment = conditionPreimage
  const fulfillmentUri = 'cf:0:' + base64url(fulfillment)
  return fulfillmentUri
}

Object.assign(exports, {
  toConditionUri,
  toFulfillmentUri
})
