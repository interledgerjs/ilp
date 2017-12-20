'use strict'

const IlpPacket = require('ilp-packet')
const compat = require('ilp-compat-plugin')
const { Reader } = require('oer-utils')
const debug = require('debug')('ilp:ildcp')

const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
const PEER_PROTOCOL_EXPIRY_DURATION = 60000

const getAccount = async (plugin) => {
  plugin = compat(plugin)

  const { ilp } = await plugin.sendTransfer({
    // TODO: Should be zero, but our plugins suck
    amount: '1',
    ilp: IlpPacket.serializeIlpForwardedPayment({
      account: 'peer.config',
      data: Buffer.alloc(0)
    }),
    executionCondition: PEER_PROTOCOL_CONDITION,
    expiresAt: new Date(Date.now() + PEER_PROTOCOL_EXPIRY_DURATION).toISOString()
  })

  console.log('ilp', ilp)

  const { data } = IlpPacket.deserializeIlpFulfillment(ilp)

  console.log('data', data)

  const reader = Reader.from(data)

  const clientName = reader.readVarOctetString().toString('ascii')

  debug('received client name ' + clientName)

  return clientName
}

module.exports = {
  getAccount
}
