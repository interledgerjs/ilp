'use strict'

const IlpPacket = require('ilp-packet')
const assert = require('assert')
const debug = require('debug')('ilp:packet')
const base64url = require('./base64url')

const serialize = (p) => {
  return base64url(IlpPacket.serializeIlpPayment(p))
}

const parse = (packet) => {
  try {
    return IlpPacket.deserializeIlpPayment(Buffer.from(packet, 'base64'))
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
