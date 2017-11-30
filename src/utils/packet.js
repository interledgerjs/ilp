'use strict'

const IlpPacket = require('ilp-packet')
const assert = require('assert')
const debug = require('debug')('ilp:packet')
const base64url = require('./base64url')

const serialize = (p) => {
  if (p.amount) {
    return base64url(IlpPacket.serializeIlpPayment(p))
  } else {
    return base64url(IlpPacket.serializeIlpForwardedPayment(p))
  }
}

const parse = (packet) => {
  try {
    return IlpPacket.deserializeIlpPacket(Buffer.from(packet, 'base64')).data
  } catch (e) {
    debug('error while parsing packet: ' + e.message)
    return undefined
  }
}

function getFromTransfer (transfer) {
  assert(transfer, 'transfer must be defined. got: ' + transfer)
  assert(typeof transfer === 'object', 'got invalid transfer: ' + transfer)
  assert(typeof transfer.ilp === 'string' &&
    transfer.ilp.match(/^[0-9A-Za-z-_]+$/),
    'transfer.ilp must be a base64url string')

  return transfer.ilp
}

function parseFromTransfer (transfer) {
  return parse(getFromTransfer(transfer))
}

module.exports = {
  serialize,
  parse,
  getFromTransfer,
  parseFromTransfer
}
