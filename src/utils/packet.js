'use strict'

const IlpPacket = require('ilp-packet')

const serialize = (p) => {
  return IlpPacket.serializeIlpPayment(p)
}

const parse = (packet) => {
  return IlpPacket.deserializeIlpPayment(Buffer.from(packet, 'base64'))
}

module.exports = {
  serialize,
  parse
}
