'use strict'

const chai = require('chai')
const moment = require('moment')
const assert = chai.assert
const crypto = require('../src/utils/crypto')
const Packet = require('../src/utils/packet')
const MockPlugin = require('./mocks/mockPlugin')
const expect = chai.expect
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

describe('cryptoHelper', function () {
  beforeEach(function () {
    this.secret = Buffer.from('secret')
    this.token = Buffer.from('PE7rnGiULIrfu655nwSYew', 'base64')
  })

  it('should generate a 16-byte PSK token', function () {
    assert.equal(crypto.getPskToken().length, 16)
  })

  it('should generate receiver id as PSK 1.0', function () {
    // hmac(secret, 'ilp_ipr_receiver_id').slice(0, 8)
    const id = Buffer
      .from('ebKWcAEB9_AQfMeMDRO-euTXeOPyKd9exYa8w0h1pmE', 'base64')
      .slice(0, 8)

    assert.equal(
      crypto.getReceiverId(this.secret).toString('hex'),
      id.toString('hex'))
  })

  it('should generate shared secret as PSK 1.0', function () {
    // hmac(hmac(secret, 'ilp_psk_generation'), token)
    const sharedSecret = Buffer
      .from('66iH2jKo-lMSs55jU8fH3Tm-G_rf9aDi-Q3bu6gddGM', 'base64')
      .slice(0, 16)

    assert.equal(
      crypto.getPskSharedSecret(this.secret, this.token).toString('hex'),
      sharedSecret.toString('hex'))
  })

  it('should generate condition preimage as PSK 1.0', function () {
    // fake packet data
    const packet = 'kybtrzvWnuJyEugU6c2JYblf6WEcU4gxBduKfq'

    // hmac(hmac(secret, 'ilp_psk_condition'), packet)
    const preimage = Buffer
      .from('rHl3k5yBZxsak4Vkvo5UswE4vjEWk-TNXPz-2syFs7A', 'base64')

    assert.equal(
      crypto.packetToPreimage(packet, this.secret).toString('hex'),
      preimage.toString('hex'))
  })
})
