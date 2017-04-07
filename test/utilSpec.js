'use strict'

const chai = require('chai')
const assert = chai.assert
const base64url = require('../src/utils/base64url')
const Packet = require('../src/utils/packet')
const Details = require('../src/utils/details')
const Utils = require('../src/utils')

describe('Utils', function () {
  describe('details', function ()  {
    it('should not parse an invalid request', function () {
      assert.throws(() => Details._parseRequest({
        request: Buffer.from('garbage', 'utf8'),
        statusLine: true 
      }),
        /invalid request:/)
    })

    it('should not allow the user to specify a nonce', function () {
      assert.throws(() => Details.createDetails({
        // make sure it's case insensitive
        publicHeaders: { nOnce: 'a very bad nonce' }
      }),
        /"Nonce" header may not be specified manually/)
    })

    it('should encrypt 64 kilobytes of data', function () {
      const len = 64000
      const secret = Buffer.from('secret')
      const details = Details.createDetails({
        publicHeaders: {},
        headers: {},
        data: Buffer.from('0'.repeat(len)),
        secret
      })
      
      const { data } = Details.parseDetails({
        details,
        secret
      })

      assert.equal(data.length, len)
    })

    it('should not parse a request with an invalid status line', function () {
      const request = `PSK/1.0 GARBAGE
Header: stuff

binary data goes here
      `
      assert.throws(() => Details._parseRequest({
        request: Buffer.from(request, 'utf8'),
        statusLine: true
      }),
        /unsupported status/)
    })

    it('should parse a request with a minor version change', function () {
      const request = `PSK/1.1
Header: stuff

binary data goes here
      `
      Details._parseRequest({
        request: Buffer.from(request, 'utf8'),
        statusLine: true
      })
    })

    it('should not parse a request without authentication tag', function () {
      const request = `PSK/1.0
Nonce: bOyTLeBv5XRfwJffYTR_tA
Encryption: aes-256-gcm
Header: stuff

binary data goes here
      `

      assert.throws(() => {
        return Details.parseDetails({
          details: base64url(Buffer.from(request, 'utf8')),
          secret: Buffer.from('secret', 'utf8')
        })
      },
        /unsupported encryption/)
    })

    it('should parse a request', function () {
      const request = `PSK/1.0
Header: value

binary data goes here`

      assert.deepEqual(
        Details._parseRequest({
          request: Buffer.from(request, 'utf8'),
          statusLine: true
        }),
        { headers: { header: 'value' },
          data: Buffer.from('binary data goes here', 'utf8')
        })
    })

    it('should parse an ILP packet with PSK details inside', function () {
      const secret = Buffer.from('secret', 'utf8')
      const packet = Packet.serialize({
        account: 'test.alice',
        amount: '1',
        data: base64url(Details.createDetails({
          headers: { header: 'value' },
          publicHeaders: { unsafeHeader: 'value' },
          data: Buffer.from('binary data', 'utf8'),
          secret
        }))
      })

      const parsed = Details.parsePacketAndDetails({ packet, secret })
      const tag = parsed.publicHeaders.encryption.split(' ')[1]
      assert.deepEqual(
        parsed,
        { publicHeaders: {
            encryption: 'aes-256-gcm ' + tag,
            // the nonce field isn't deterministic
            nonce: parsed.publicHeaders.nonce,
            unsafeheader: 'value'
          },
          headers: { header: 'value' },
          data: Buffer.from('binary data', 'utf8'),
          account: 'test.alice',
          amount: '1'
        })
    })
  })

  describe('retryPromise', () => {
    beforeEach(function () {
      this.minWait = 10
      this.maxWait = 10

      this.stopWaiting = new Date()
      this.stopWaiting.setSeconds(this.stopWaiting.getSeconds + 1)
    })

    it('should retry a promise', function * () {
      let counter = 0
      const callback = () => {
        if (counter++ < 3) {
          return Promise.reject(new Error('please retry'))
        }
        return Promise.resolve('success!')
      }

      yield Utils.retryPromise({
        callback,
        minWait: this.minWait,
        maxWait: this.maxWait,
        stopWaiting: this.stopWaiting
      })
    })

    it('should stop retring after expiry', function * () {
      yield assert.isRejected(Utils.retryPromise({
        callback: () => Promise.reject(new Error('please retry')),
        minWait: this.minWait,
        maxWait: this.maxWait,
        stopWaiting: (new Date())
      }), /retry expiry of .* reached/)
    })
  })
})
