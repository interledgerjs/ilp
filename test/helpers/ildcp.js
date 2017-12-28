'use strict'

const IlpPacket = require('ilp-packet')
const { Writer } = require('oer-utils')

const isIldcpRequest = (packet) => {
  if (packet[0] !== IlpPacket.Type.TYPE_ILP_PREPARE) {
    return false
  }

  const parsedPacket = IlpPacket.deserializeIlpPrepare(packet)

  return parsedPacket.destination === 'peer.config'
}

const createIldcpResponse = ({ address, currencyCode, currencyScale }) => {
  const writer = new Writer()
  writer.writeVarOctetString(Buffer.from(address, 'ascii'))
  writer.writeUInt8(currencyScale)
  writer.writeVarOctetString(Buffer.from(currencyCode, 'utf8'))
  return IlpPacket.serializeIlpFulfill({
    fulfillment: Buffer.alloc(32),
    data: writer.getBuffer()
  })
}

module.exports = {
  isIldcpRequest,
  createIldcpResponse
}
