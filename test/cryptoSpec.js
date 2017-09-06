'use strict'

const chai = require('chai')
const moment = require('moment')
const assert = chai.assert
const crypto = require('../src/utils/crypto')
const Packet = require('../src/utils/packet')
const base64url = require('../src/utils/base64url')
const MockPlugin = require('./mocks/mockPlugin')
const expect = chai.expect
const chaiAsPromised = require('chai-as-promised')
const testData = require('./data/psk.json')

chai.use(chaiAsPromised)

let i = 1;
testData.forEach(function(receiver) {
  receiver.testVectors.forEach(function(testVector){
    describe('cryptoHelper ' + i , function () {
      beforeEach(function () {
        this.secret = Buffer.from(receiver.receiverSecret, 'hex')
        this.token = Buffer.from(testVector.token, 'hex')
      })


      it('should generate a 16-byte PSK token', function () {
        assert.equal(crypto.getPskToken().length, 16)
      })

      it('should generate receiver id as PSK 1.0', function () {
        // hmac(secret, 'ilp_ipr_receiver_id').slice(0, 8)
   
        assert.equal(
          crypto.getReceiverId(this.secret).toString('hex').toLowerCase(),
          testVector.receiverId.toLowerCase())
      })

      it('should generate shared secret as PSK 1.0', function () {
        // hmac(hmac(secret, 'ilp_psk_generation'), token)
        
        assert.equal(
          crypto.getPskSharedSecret(this.secret, this.token).toString('hex').toLowerCase(),
          testVector.sharedKey.toLowerCase())
      })

      it('should generate condition preimage as PSK 1.0', function () {
        // fake packet data
        // hmac(hmac(secret, 'ilp_psk_condition'), packet)
        const packet = Buffer
          .from(testVector.packet, 'hex')

        assert.equal(
          crypto.packetToPreimage(
              base64url(packet), 
              crypto.getPskSharedSecret(this.secret, this.token))
            .toString('hex').toLowerCase(),
          testVector.preimage.toLowerCase())
      })
    })
    i++
  }, this)
}, this)
