'use strict'

const co = require('co')
const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert
const expect = chai.expect
const moment = require('moment')

const ILP = require('..')
const Transport = require('../src/lib/transport')
const Packet = require('../src/utils/packet')
const MockPlugin = require('./mocks/mockPlugin')
const { wait } = require('../src/utils')

describe('Transport', function () {
  describe('PSK', function () {
    beforeEach(function () {
      this.params = {
        destinationAccount: 'test.example.alice',
        secretSeed: Buffer.from('shh_its_a_secret', 'base64')
      }
    })

    it('should generate psk params', function () {
      const params = ILP.PSK.generateParams(this.params)

      assert.match(params.destinationAccount, /^test\.example\.alice/)
      assert.isString(params.sharedSecret)
    })
  })

  describe('createPacketAndCondition', function () {
    beforeEach(function () {
      this.params = {
        destinationAmount: '1',
        destinationAccount: 'test.example.alice',
        secret: Buffer.from('shh_its_a_secret', 'base64'),
        data: { foo: 'bar' },
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().format()
      }

      this.validate = (result) => {
        const { account, amount, data } = Packet.parse(result.packet)

        // the data is still encrypted, so we can't check it from just parsing
        assert.isString(data)
        assert.equal(amount, '1')
        assert.match(account, /^test\.example\.alice\.~(psk|ipr)/)
      }
    })

    it('should create a valid packet and condition', function () {
      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)
    })

    it('should generate an id if one isn\'t provided', function () {
      delete this.params.id
      const result = Transport.createPacketAndCondition(this.params, 'psk')
      this.validate(result)

      const parsed = Packet.parse(result.packet)
      assert.match(parsed.account,
        /test\.example\.alice\.~psk\..{8}/)
    })

    describe('IPR', function () {
      it('should create packet and condition', function () {
        const result = ILP.IPR.createPacketAndCondition(this.params)
        this.validate(result)
      })
    })

    describe('PSK', function () {
      it('should create packet and condition', function () {
        // one field name is different
        this.params.sharedSecret = this.params.secret

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
        secret: Buffer.from('shh_its_a_secret', 'base64')
      }
    })

    it('should listen', function * () {
      const res = yield Transport.listen(this.plugin, this.params, () => {})
      assert.isFunction(res, 'should return a function')
    })

    it('should throw if connect rejects', function * () {
      this.plugin.connect = () => Promise.reject('an error!')
      yield expect(Transport.listen(this.plugin, this.params, () => {}))
        .to.eventually.be.rejectedWith(/an error!/)
    })

    it('should remove listeners with its function', function * () {
      const res = yield Transport.listen(this.plugin, this.params, () => {})
      assert.equal(this.plugin.listenerCount('incoming_prepare'), 1)
      res()
      assert.equal(this.plugin.listenerCount('incoming_prepare'), 0)
    })

    describe('IPR', function () {
      it('should listen via function in IPR', function * () {
        const res = yield ILP.IPR.listen(this.plugin, this.params, () => {})
        assert.isFunction(res, 'should return a function')
      })
    })

    describe('PSK', function () {
      it('should listen via function in PSK', function * () {
        this.params.sharedSecret = this.params.secret
        delete this.params.secret

        const res = yield ILP.PSK.listen(this.plugin, this.params, () => {})
        assert.isFunction(res, 'should return a function')
      })
    })
  })

  describe('_validateOrRejectTransfer', function () {
    beforeEach(function () {
      const { packet, condition } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice',
        secret: Buffer.from('shh_its_a_secret', 'base64'),
        data: { foo: 'bar' },
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().add(1, 'seconds').format(),
      }, 'ipr')

      this.packet = packet
      this.params = {
        protocol: 'ipr',
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        plugin: this.plugin,
        secret: Buffer.from('shh_its_a_secret', 'base64'),
        transfer: {
          id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
          amount: '1',
          to: 'test.example.alice',
          from: 'test.example.connie',
          executionCondition: condition,
          ilp: packet
        }
      }

      this.rejected = new Promise((resolve) => {
        this.plugin.rejectIncomingTransfer = (id, msg) => {
          resolve(msg)
          return Promise.resolve()
        }
      })
    })

    it('should accept a valid transfer', function * () {
      yield Transport._validateOrRejectTransfer(this.params)
    })

    it('should ignore transfer without condition', function * () {
      delete this.params.transfer.executionCondition
      assert.deepEqual(
        yield Transport._validateOrRejectTransfer(this.params),
        { code: 'S00',
          message: 'got notification of transfer without executionCondition',
          name: 'Bad Request'
        })
    })

    it('should ignore transfer for other account', function * () {
      this.params.transfer.ilp = Packet.serialize(Object.assign(
        Packet.parse(this.packet),
        { account: 'test.example.garbage' }))

      assert.equal(
        yield Transport._validateOrRejectTransfer(this.params),
        'not-my-packet')
    })

    it('should not accept transfer for other protocol', function * () {
      this.params.transfer.ilp = Packet.serialize(Object.assign(
        Packet.parse(this.packet),
        { account: 'test.example.alice.~ekp' }))

      assert.equal(
        yield Transport._validateOrRejectTransfer(this.params),
        'not-my-packet')
    })

    it('should not accept transfer for other receiver', function * () {
      this.params.transfer.ilp = Packet.serialize(Object.assign(
        Packet.parse(this.packet),
        { account: 'test.example.alice.~ipr.garbage' }))

      assert.equal(
        yield Transport._validateOrRejectTransfer(this.params),
        'not-my-packet')
    })

    it('should reject transfer for too little money', function * () {
      this.params.transfer.amount = '0.1'
      assert.deepEqual(
        yield Transport._validateOrRejectTransfer(this.params),
        { code: 'S04',
          message: 'got notification of transfer where amount is less than expected',
          name: 'Insufficient Destination Amount'
        })

      yield this.rejected
    })

    it('should reject transfer for too much money', function * () {
      this.params.transfer.amount = '1.1'
      assert.deepEqual(
        yield Transport._validateOrRejectTransfer(this.params),
        { code: 'S03',
          message: 'got notification of transfer where amount is more than expected',
          name: 'Invalid Amount'
        })

      yield this.rejected
    })

    it('should accept extra money with "allowOverPayment"', function * () {
      this.params.transfer.amount = '1.1'
      this.params.allowOverPayment = true
      // no error-code is returned on success
      assert.isNotOk(
        yield Transport._validateOrRejectTransfer(this.params))
    })

    it('should not accept late transfer', function * () {
      const { packet, condition } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice',
        secret: Buffer.from('shh_its_a_secret', 'base64'),
        data: { foo: 'bar' },
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().add(-1, 'seconds').format(),
      }, 'ipr')

      this.params.transfer.ilp = packet

      assert.deepEqual(
        yield Transport._validateOrRejectTransfer(this.params),
        { code: 'R01',
          message: 'got notification of transfer with expired packet',
          name: 'Payment Timed Out'
        })

      yield this.rejected
    })
  })

  describe('autoFulfillCondition', function () {
    beforeEach(function () {
      const { packet, condition } = Transport.createPacketAndCondition({
        destinationAmount: '1',
        destinationAccount: 'test.example.alice.~ipr.GbLOVv3YyLo',
        secret: Buffer.from('shh_its_a_secret', 'base64'),
        data: { foo: 'bar' },
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        expiresAt: moment().add(1, 'seconds').format(),
        protocol: 'ipr'
      })

      this.params = {
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        secret: Buffer.from('shh_its_a_secret', 'base64'),
      }

      this.transfer = {
        id: 'ee39d171-cdd5-4268-9ec8-acc349666055',
        amount: '1',
        to: 'test.example.alice.~ipr.GbLOVv3YyLo',
        from: 'test.example.connie',
        executionCondition: condition,
        ilp: packet
      }

      // detect when autofulfill promise has resolved
      this.fulfilled = new Promise((resolve) => {
        this.callback = resolve
      })

      this.rejected = new Promise((resolve) => {
        this.plugin.rejectIncomingTransfer = (id, msg) => {
          resolve(msg)
          return Promise.resolve()
        }
      })
    })

    it('should call fulfillCondition on a valid incoming transfer', function * () {
      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')

      // listener returns true for debug purposes
      const res = yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      assert.isTrue(res[0])

      yield this.fulfilled
    })

    it('should reject when it generates the wrong fulfillment', function * () {
      this.transfer.executionCondition = 'garbage'
      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')

      // listener returns false for debug purposes
      yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      yield this.rejected
    })

    it('should reject when packet details have been changed', function * () {
      this.transfer.ilp = this.transfer.ilp + '0'
      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')

      // listener returns false for debug purposes
      yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      yield this.rejected
    })

    it('should pass the fulfill function, transfer, decrypted data, destinationAmount, and destinationAccount to the callback', function * () {
      const fulfilled = new Promise((resolve) => {
        this.plugin.fulfillCondition = () => {
          resolve()
          return Promise.resolve()
        }
      })

      this.callback = (details) => {
        assert.isObject(details.transfer, 'must pass in transfer')
        assert.isObject(details.data, 'must pass in decrypted data')
        assert.isString(details.destinationAccount, 'must pass in account')
        assert.isString(details.destinationAmount, 'must pass in amount')
        assert.isFunction(details.fulfill, 'fulfill callback must be a function')
        details.fulfill()
      }

      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')
      yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      yield fulfilled
    })

    it('should reject if the listen callback throws', function * () {
      const rejected = new Promise((resolve) => {
        this.plugin.rejectIncomingTransfer = () => {
          resolve()
          return Promise.resolve()
        }
      })

      this.callback = (details) => {
        throw new Error('I don\'t want that transfer')
      }

      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')
      const res = yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      assert.deepEqual(res[0], {
        code: 'S00',
        message: 'rejected-by-receiver: I don\'t want that transfer',
        name: 'Bad Request'
      })

      yield rejected
    })

    it('should reject if the listen callback rejects', function * () {
      const rejected = new Promise((resolve) => {
        this.plugin.rejectIncomingTransfer = () => {
          resolve()
          return Promise.resolve()
        }
      })

      this.callback = (details) => {
        return Promise.reject(new Error('I don\'t want that transfer'))
      }

      yield Transport.listen(this.plugin, this.params, this.callback, 'ipr')
      const res = yield this.plugin.emitAsync('incoming_prepare', this.transfer)
      assert.deepEqual(res[0], {
        code: 'S00',
        message: 'rejected-by-receiver: I don\'t want that transfer',
        name: 'Bad Request'
      })

      yield rejected
    })
  })
})
