'use strict'

const IlpPacket = require('ilp-packet')
const debug = require('debug')('ilp:packet')

const serialize = (p) => {
  return IlpPacket.serializeIlpPayment(p)
}

const parse = (packet) => {
  try {
    return IlpPacket.deserializeIlpPayment(Buffer.from(packet, 'base64'))
  } catch (e) {
    debug('error while parsing packet: ' + e.message)
    return undefined
  }
}

module.exports = {
  serialize,
  parse
}
