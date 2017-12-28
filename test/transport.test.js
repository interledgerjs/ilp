'use strict'

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert
const expect = chai.expect
const sinon = require('sinon')
const moment = require('moment')
const IlpPacket = require('ilp-packet')

const ILP = require('..')
const Transport = require('../src/lib/transport')
const Packet = require('../src/utils/packet')
const MockPlugin = require('./mocks/mockPlugin')
const base64url = require('../src/utils/base64url')
const { parsePacketAndDetails } = require('../src/utils/details')
const cryptoHelper = require('../src/utils/crypto')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('Transport', function () {
  describe('PSK', function () {
    beforeEach(function () {
      this.params = {
        destinationAccount: 'test.example.alice',
        receiverSecret: Buffer.from('secret')
      }
    })

    it('should generate psk params', function () {
      const params = ILP.PSK.generateParams(this.params)

      assert.match(params.destinationAccount, /^test\.example\.alice/)
      assert.isString(params.sharedSecret)
    })
  })

  describe('IPR', function () {
    beforeEach(function () {
      this.secret = Buffer.from('secret')
      this.params = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ',
        secret: this.secret,
        data: Buffer.from('test data'),
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().toISOString()
      })
    })

    it('should encode an IPR properly', function () {
      const ipr = ILP.IPR.encodeIPR(this.params)

      // version byte at the start
      assert.equal(ipr.slice(0, 1).toString('hex'), '02')
      // condition should come next
      assert.equal(ipr.slice(1, 33).toString('hex'), this.params.condition.toString('hex'))
      // ignore the two length bytes before the variable octet string
      assert.equal(ipr.slice(35).toString('hex'), this.params.packet.toString('hex'))
    })

    it('should not encode an IPR with an invalid condition', function () {
      this.params.condition += 'aadoimawdadoiamdwad'
      assert.throws(() => ILP.IPR.encodeIPR(this.params),
        /params.condition must encode 32 bytes/)
    })

    it('should decode an IPR', function () {
      const ipr = Buffer.from(
        '0289d6ba47b7bb8fd72bede6ae57dd0adaaca5eca79c8f25ac9c33019e54bdcb8f8' +
        '1c80181c5000000000000000134746573742e6578616d706c652e616c6963652e65' +
        '624b5763414542395f41476d65574958334431464c7749583043467666465351818' +
        '550534b2f312e300a4e6f6e63653a203049494d742d6d38794c5851304a4f693469' +
        '766972510a456e6372797074696f6e3a206165732d3235362d67636d20303137432' +
        'd33677731726a455a7a71753332695636670a0a5e2b0de9974e3aefedfe8e85740b' +
        'cd8dff4af2aaed3311d05e808e2e4b3f4eb49670e260915befca7e9aa7da7c970400',
        'hex')

      const conditionFixture =
        'ida6R7e7j9cr7eauV90K2qyl7KecjyWsnDMBnlS9y48'

      const packetFixture =
        'AYHFAAAAAAAAAAE0dGVzdC5leGFtcGxlLmFsaWNlLmViS1djQUVCOV9BR21lV0lYM0Q' +
        'xRkx3SVgwQ0Z2ZkZTUYGFUFNLLzEuMApOb25jZTogMElJTXQtbTh5TFhRMEpPaTRpdm' +
        'lyUQpFbmNyeXB0aW9uOiBhZXMtMjU2LWdjbSAwMTdDLTNndzFyakVaenF1MzJpVjZnC' +
        'gpeKw3pl0467-3-joV0C82N_0ryqu0zEdBegI4uSz9OtJZw4mCRW-_Kfpqn2nyXBAA'

      const { packet, condition } = ILP.IPR.decodeIPR(ipr)

      assert.equal(condition, conditionFixture)
      assert.equal(packet, packetFixture)
    })
  })

  describe('createPacketAndCondition', function () {
    beforeEach(function () {
      this.secret = Buffer.from('secret')
      this.params = {
        destinationAmount: '1',
        destinationAccount: 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ',
        secret: this.secret,
        data: Buffer.from('test data'),
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().toISOString()
      }

      this.validate = (result) => {
        const { account, amount, data } = Packet.parse(result.packet)
        const receiverId = base64url(cryptoHelper.getReceiverId(this.secret))

        // the data is still encrypted, so we can't check it from just parsing
        assert(Buffer.isBuffer(data), 'data should be a buffer')
        assert.equal(amount, '1')
        assert.equal(account, 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ')
        assert.equal(receiverId, 'ebKWcAEB9_A')
      }
    })

    it('should create a valid packet and condition', function () {
      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)
    })

    it('should take additional headers for details', function () {
      this.params.headers = { header: 'value' }
      this.params.publicHeaders = { unsafeHeader: 'unsafeValue' }

      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)

      const details = parsePacketAndDetails({
        packet: result.packet,
        secret: this.params.secret
      })

      assert.match(details.publicHeaders['encryption'], /^aes-256-gcm /)
      assert.match(details.publicHeaders['nonce'], /[A-Za-z0-9_-]{22}/)
      assert.equal(details.publicHeaders['unsafeheader'], 'unsafeValue')
      assert.equal(details.headers['expires-at'], this.params.expiresAt)
      assert.equal(details.headers['header'], 'value')
    })

    it('should throw an error if the header name contains a line feed or colon', function () {
      this.params.headers = { 'Header-With-\nLine-Feed': 'value' }

      assert.throws(Transport.createPacketAndCondition.bind(null, this.params, 'psk'),
        /Found forbidden characters in header name: "Header-With-\\nLine-Feed"/)

      this.params.headers = { 'Header-With-:Colon': 'value' }

      assert.throws(Transport.createPacketAndCondition.bind(null, this.params, 'psk'),
        /Found forbidden characters in header name: "Header-With-:Colon"/)
    })

    it('should throw an error if header value contains a line feed', function () {
      this.params.headers = { 'Some-Header': 'value\nX-Header-Injection: Some-Value' }

      assert.throws(Transport.createPacketAndCondition.bind(null, this.params, 'psk'),
        /Found forbidden characters in header value: "value\\nX-Header-Injection: Some-Value"/)
    })

    it('should allow unicode characters, SPSP addresses, and URLs in header values', function () {
      this.params.headers = {
        sender: 'Pièrre',
        'source-image-url': 'https://sending-ilpkit.example/pic?user=pierre',
        'source-identifier': 'pierre@sending-ilpkit.example'
      }

      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)

      const details = parsePacketAndDetails({
        packet: result.packet,
        secret: this.params.secret
      })

      assert.equal(details.headers['sender'], 'Pièrre')
      assert.equal(details.headers['source-image-url'], 'https://sending-ilpkit.example/pic?user=pierre')
      assert.equal(details.headers['source-identifier'], 'pierre@sending-ilpkit.example')
    })

    it('should allow encryption to be disabled', function () {
      this.params.disableEncryption = true
      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)

      const details = parsePacketAndDetails({
        // no secret provided, because no encryption
        packet: result.packet
      })

      assert.equal(details.publicHeaders['encryption'], 'none')
      assert.equal(details.headers['expires-at'], this.params.expiresAt)
    })

    describe('IPR', function () {
      it('should create packet and condition', function () {
        this.params.receiverSecret = Buffer.from('secret')
        this.params.destinationAccount = 'test.example.alice'
        delete this.params.secret

        const result = ILP.IPR.createPacketAndCondition(this.params)
        const { account } = Packet.parse(result.packet)
        assert.match(account,
          /test\.example\.alice\.ebKWcAEB9_A[A-Za-z0-9_-]{22}/)
      })
    })

    describe('PSK', function () {
      it('should create packet and condition', function () {
        // one field name is different, and takes a string
        this.params.sharedSecret = 'bo4GhvVNW8nacSz0PvibKA'
        delete this.params.secret

        const result = ILP.PSK.createPacketAndCondition(this.params)
        this.validate(result)
      })
    })
  })

  beforeEach(function () {
    this.plugin = new MockPlugin()
  })

  describe('listen', function () {
    beforeEach(function () {
      this.params = {
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        receiverSecret: Buffer.from('bo4GhvVNW8nacSz0PvibKA', 'base64'),
        connectTimeout: 100
      }
    })

    it('should listen', async function () {
      const res = await Transport.listen(this.plugin, this.params, () => {})
      assert.isFunction(res, 'should return a function')
    })

    it('should throw if connect rejects', async function () {
      this.plugin.connect = () => Promise.reject(new Error('an error!'))
      await expect(Transport.listen(this.plugin, this.params, () => {}))
        .to.eventually.be.rejectedWith(/an error!/)
    })

    it('should remove listeners with its function', async function () {
      const res = await Transport.listen(this.plugin, this.params, () => {})
      assert(this.plugin._dataHandler, 'a handler must be set')
      res()
      assert(!this.plugin._dataHandler, 'no handler must be set')
    })

    describe('IPR', function () {
      it('should listen via function in IPR', async function () {
        const res = await ILP.IPR.listen(this.plugin, this.params, () => {})
        assert.isFunction(res, 'should return a function')
      })
    })

    describe('PSK', function () {
      it('should listen via function in PSK', async function () {
        this.params.sharedSecret = this.params.secret
        delete this.params.secret

        const res = await ILP.PSK.listen(this.plugin, this.params, () => {})
        assert.isObject(res, 'should return an object')
        assert.isFunction(res.close, 'should have a close method')
        assert.isString(res.sharedSecret, 'should have a shared secret')
        assert.isString(res.destinationAccount, 'should have a destination account')
      })
    })
  })

  describe('_validateOrRejectTransfer', function () {
    beforeEach(function () {
      const { packet, condition } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ',
        secret: Buffer.from('bo4GhvVNW8nacSz0PvibKA', 'base64'),
        data: Buffer.from('test data'),
        expiresAt: moment().add(1, 'seconds').toISOString()
      }, 'ipr')

      this.packet = packet
      this.params = {
        plugin: this.plugin,
        address: 'test.example.alice',
        receiverSecret: Buffer.from('secret'),
        transfer: {
          amount: '1',
          executionCondition: condition,
          ilp: packet
        },
        parsedPacket: IlpPacket.deserializeIlpPayment(packet)
      }
    })

    it('should accept a valid transfer', async function () {
      await Transport._validateOrRejectTransfer(this.params)
    })

    it('should reject transfer without PSK data', async function () {
      this.params.parsedPacket.data = Buffer.from('garbage')

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('unspecified PSK error')
    })

    it('should reject transfer with unsupported PSK encryption', async function () {
      this.params.parsedPacket.data = Buffer.from(`PSK/1.0
Nonce: KxjrC8g5qGQ7mj_ODqBMtw
Encryption: rot13

data`, 'utf8')

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('unsupported PSK encryption method')
    })

    it('should reject transfer without PSK nonce', async function () {
      this.params.parsedPacket.data = Buffer.from(`PSK/1.0
Encryption: aes-256-gcm PVWdX4iBjPQg16AOli2CBw

data`, 'utf8')

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('missing PSK nonce') // F06
    })

    it('should reject transfer with PSK key header', async function () {
      this.params.parsedPacket.data = Buffer.from(`PSK/1.0
Nonce: KxjrC8g5qGQ7mj_ODqBMtw
Encryption: aes-256-gcm PVWdX4iBjPQg16AOli2CBw
Key: ed25519-ecdh

data`, 'utf8')

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('unsupported PSK key derivation') // F06
    })

    it('should reject transfer withbad PSK status line', async function () {
      this.params.parsedPacket.data = Buffer.from(`PSK/2.0

data`, 'utf8')

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('unsupported PSK version or status') // F06
    })

    it('should ignore transfer for other account', async function () {
      this.params.parsedPacket.account = 'test.example.garbage'

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('received payment for another account') // F06
    })

    it('should reject transfer for other receiver', async function () {
      this.params.parsedPacket.account = 'test.example.alice.garbage'

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('received payment for another receiver') // F06
    })

    it('should reject transfer for too little money', async function () {
      this.params.transfer.amount = '0.1'

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('got notification of transfer where amount is less than expected') // F04
    })

    it('should accept extra money', async function () {
      this.params.transfer.amount = '1.1'
      assert.isNotOk(Transport._validateOrRejectTransfer(this.params))
    })

    it('should reject transfer for too much money if allowOverPayment == false', async function () {
      this.params.transfer.amount = '1.1'
      this.params.allowOverPayment = false

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('got notification of transfer where amount is more than expected') // F03
    })

    it('should not accept late transfer', async function () {
      const { packet } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ',
        secret: Buffer.from('bo4GhvVNW8nacSz0PvibKA', 'base64'),
        data: Buffer.from('test data'),
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().add(-1, 'seconds').toISOString()
      })

      this.params.parsedPacket = IlpPacket.deserializeIlpPayment(packet)

      expect(() => Transport._validateOrRejectTransfer(this.params))
        .to.throw('got notification of transfer with expired packet') // R00
    })
  })

  describe('handleData', function () {
    beforeEach(function () {
      this.clock = sinon.useFakeTimers(START_DATE)

      const expiresAt = moment().add(1, 'seconds').toDate()
      const destination = 'test.example.alice.ebKWcAEB9_AGmeWIX3D1FLwIX0CFvfFSQ'

      const { packet, condition } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: destination,
        secret: Buffer.from('bo4GhvVNW8nacSz0PvibKA', 'base64'),
        data: Buffer.from('test data'),
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: expiresAt.toISOString(),
        nonce: Buffer.from('KVwyXszKSl3PCZdOUGjPQg==', 'base64')
      })

      this.callback = (details) => {
        return details.fulfill()
      }

      this.params = {
        plugin: this.plugin,
        address: 'test.example.alice',
        receiverSecret: Buffer.from('secret'),
        callback: this.callback
      }

      this.transferProps = {
        amount: '1',
        executionCondition: condition,
        expiresAt,
        destination,
        data: packet
      }
      this.transfer = IlpPacket.serializeIlpPrepare(this.transferProps)
    })

    it('should fulfill on a valid incoming transfer', async function () {
      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpFulfill(result), {
        fulfillment: Buffer.from('AX7EYPqPeG5JI3rv6b+RfGZ3D1Y1pSjj/QJFJ556Dpg=', 'base64'),
        data: Buffer.alloc(0)
      })
    })

    it('should fulfill on an overpaid valid incoming transfer', async function () {
      this.transferProps.amount = '101'
      this.transfer = IlpPacket.serializeIlpPrepare(this.transferProps)

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpFulfill(result), {
        fulfillment: Buffer.from('AX7EYPqPeG5JI3rv6b+RfGZ3D1Y1pSjj/QJFJ556Dpg=', 'base64'),
        data: Buffer.alloc(0)
      })
    })

    it('should reject when it generates the wrong fulfillment', async function () {
      this.transferProps.executionCondition = Buffer.alloc(32)
      this.transfer = IlpPacket.serializeIlpPrepare(this.transferProps)

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F05',
        message: 'receiver generated a different condition from the transfer',
        triggeredBy: 'test.example.alice',
        data: Buffer.alloc(0)
      })
    })

    it('should reject on an overpaid incoming transfer if allowOverPayment is off', async function () {
      this.params.allowOverPayment = false
      this.transferProps.amount = '101'
      this.transfer = IlpPacket.serializeIlpPrepare(this.transferProps)

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F03',
        message: 'got notification of transfer where amount is more than expected',
        triggeredBy: 'test.example.alice',
        data: Buffer.alloc(0)
      })
    })

    it('should reject when packet details have been changed', async function () {
      this.transferProps.data = Buffer.concat([this.transferProps.data, Buffer.from('garbage')])
      this.transfer = IlpPacket.serializeIlpPrepare(this.transferProps)

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F05',
        message: 'receiver generated a different condition from the transfer',
        triggeredBy: 'test.example.alice',
        data: Buffer.alloc(0)
      })
    })

    it('should pass the fulfill function, transfer, decrypted data, destinationAmount, and destinationAccount to the callback', async function () {
      this.params.callback = sinon.spy((details) => {
        assert.isObject(details.transfer, 'must pass in transfer')
        assert.isObject(details.headers, 'must pass in headers')
        assert.isString(details.headers['expires-at'], 'must pass in Expires-At header')
        assert.isObject(details.publicHeaders, 'must pass in publicHeaders')
        assert.equal(details.data.toString('utf8'), 'test data', 'must pass in decrypted data')
        assert.isString(details.destinationAccount, 'must pass in account')
        assert.isString(details.destinationAmount, 'must pass in amount')
        assert(Buffer.isBuffer(details.fulfillment), 'must pass in fulfillment')
        assert.equal(details.fulfillment.toString('base64'), 'AX7EYPqPeG5JI3rv6b+RfGZ3D1Y1pSjj/QJFJ556Dpg=')
        assert.isFunction(details.fulfill, 'fulfill callback must be a function')
        return details.fulfill()
      })

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpFulfill(result), {
        fulfillment: Buffer.from('AX7EYPqPeG5JI3rv6b+RfGZ3D1Y1pSjj/QJFJ556Dpg=', 'base64'),
        data: Buffer.alloc(0)
      })
      assert(this.params.callback.calledOnce)
    })

    it('should reject if the listen callback throws', async function () {
      this.params.callback = (details) => {
        throw new Error('I don\'t want that transfer')
      }

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F99',
        message: 'rejected-by-receiver: I don\'t want that transfer',
        triggeredBy: 'test.example.alice',
        data: Buffer.alloc(0)
      })
    })

    it('should reject if the listen callback rejects', async function () {
      this.params.callback = (details) => {
        return Promise.reject(new Error('I don\'t want that transfer'))
      }

      const result = await Transport.handleData(this.params, this.transfer)

      assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
        code: 'F99',
        message: 'rejected-by-receiver: I don\'t want that transfer',
        triggeredBy: 'test.example.alice',
        data: Buffer.alloc(0)
      })
    })
  })
})
