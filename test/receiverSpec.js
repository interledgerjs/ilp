'use strict'

const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
require('sinon-as-promised')
chai.use(sinonChai)
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const timekeeper = require('timekeeper')
const _ = require('lodash')
const EventEmitter = require('eventemitter2')
const mockRequire = require('mock-require')

const cryptoHelper = require('../src/utils/crypto')
const createReceiver = require('../src/lib/receiver').createReceiver
const createSender = require('../src/lib/sender').createSender
const MockClient = require('./mocks/mockCore').Client
const transfer = require('./data/transferIncoming.json')

describe('Receiver Module', function () {
  beforeEach(function () {
    this.client = new MockClient({
      account: 'ilpdemo.blue.bob'
    })
    this.transfer = _.cloneDeep(transfer)
    timekeeper.freeze(new Date(0))
  })

  afterEach(function () {
    timekeeper.reset()
  })

  describe('createReceiver', function () {
    it('should throw an error if the hmacKey is not a buffer', function () {
      expect(() => {
        createReceiver({
          client: this.client,
          hmacKey: 'secret'
        })
      }).to.throw('hmacKey must be 32-byte Buffer if supplied')
    })

    it('should throw an error if the hmacKey is less than 32 bytes', function () {
      expect(() => {
        createReceiver({
          client: this.client,
          hmacKey: Buffer.from('secret')
        })
      }).to.throw('hmacKey must be 32-byte Buffer if supplied')
    })

    it('should throw an error if the roundingMode is invalid', function () {
      expect(() => createReceiver({
        client: this.client,
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
        roundingMode: 'blah'
      })).to.throw('invalid roundingMode: blah')
    })

    it('should accept lower case roundingMode', function () {
      expect(() => createReceiver({
        client: this.client,
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
        roundingMode: 'up'
      })).to.not.throw(/.*/)
    })

    it('should return an object that is an EventEmitter with the `createRequest` and `listen` functions', function () {
      const receiver = createReceiver({
        client: this.client,
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64')
      })
      expect(receiver).to.be.a('object')
      expect(receiver).to.be.instanceOf(EventEmitter)
      expect(receiver.createRequest).to.be.a('function')
      expect(receiver.listen).to.be.a('function')
    })

    it('should generate a random hmacKey if one is not supplied', function () {
      const stub = sinon.stub().withArgs(32).returns(Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'))
      mockRequire('crypto', {
        randomBytes: stub,
        createHmac: require('crypto').createHmac
      })
      mockRequire.reRequire('../src/utils/crypto')
      const createReceiverWithMock = mockRequire.reRequire('../src/lib/receiver').createReceiver
      createReceiverWithMock({
        client: this.client
      })
      expect(stub).to.have.been.calledOnce
      mockRequire.stop('crypto')
    })

    it('should instantiate a new ilp-core Client if one is not supplied', function () {
      const stub = sinon.stub().returns({})
      const fakePlugin = function () {}
      mockRequire('ilp-core', {
        Client: stub
      })
      const createReceiverWithMock = mockRequire.reRequire('../src/lib/receiver').createReceiver
      createReceiverWithMock({
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
        plugin: fakePlugin,
        auth: { some: 'auth' }
      })
      expect(stub).to.have.been.calledOnce
      expect(stub).to.have.been.calledWithMatch({
        plugin: fakePlugin,
        auth: { some: 'auth' }
      })
      mockRequire.stop('ilp-core')
    })
  })

  describe('Receiver', function () {
    beforeEach(function * () {
      this.receiver = createReceiver({
        client: this.client,
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64')
      })
    })

    describe('getAddress', function () {
      beforeEach(function * () {
        yield this.receiver.listen()
      })

      it('should throw an error if the plugin is not connected', function () {
        const stub = sinon.stub(this.client, 'getPlugin')
          .returns({
            getAccount: () => Promise.resolve(null),
            isConnected: () => false
          })
        let error
        try {
          this.receiver.getAddress()
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('receiver must be connected to get address')
      })

      it('should return the receiver ILP address', function () {
        expect(this.receiver.getAddress()).to.equal('ilpdemo.blue.bob')
      })
    })

    describe('createRequest', function () {
      beforeEach(function * () {
        yield this.receiver.listen()
      })

      it('should throw an error if the plugin is not connected', function () {
        const stub = sinon.stub(this.client, 'getPlugin')
          .returns({
            getAccount: () => Promise.resolve(null),
            isConnected: () => false
          })
        expect(() => {
          this.receiver.createRequest({})
        }).to.throw('receiver must be connected to create requests')
      })

      it('should throw an error if no amount is given', function () {
        expect(() => {
          this.receiver.createRequest({})
        }).to.throw('amount is required')
      })

      it('should throw an error if the amount has more decimal places than the ledger supports', function () {
        expect(() => {
          this.receiver.createRequest({
            amount: '10.001'
          })
        }).to.throw(/request amount has more decimal places than the ledger supports \(\d+\)/)
      })

      it('should throw an error if the amount has more significant digits than the ledger supports', function () {
        expect(() => {
          this.receiver.createRequest({
            amount: '1000000000.1'
          })
        }).to.throw(/request amount has more significant digits than the ledger supports \(\d+\)/)
      })

      it('should throw an error if expiresAt is invalid', function () {
        expect(() => {
          this.receiver.createRequest({
            amount: 10,
            expiresAt: 'blah'
          })
        }).to.throw('expiresAt must be an ISO 8601 timestamp')
      })

      it('should throw an error if the roundingMode is invalid', function () {
        expect(() => {
          this.receiver.createRequest({
            amount: 10,
            roundingMode: 'blah'
          })
        }).to.throw('invalid roundingMode: blah')
      })

      it('should return a JSON object', function () {
        expect(this.receiver.createRequest({
          amount: 10
        })).to.be.a('object')
      })

      it('should use the account from the client in the address', function () {
        const request = this.receiver.createRequest({
          amount: 10
        })
        expect(request.address).to.match(/^ilpdemo\.blue\.bob/)
      })

      it('should allow a different account to be specified', function () {
        const request = this.receiver.createRequest({
          amount: 10,
          account: 'something.else'
        })
        expect(request.address).to.match(/^something\.else/)
      })

      it('should create a request-specific address using the account, receiver id, and request id', function () {
        const request = this.receiver.createRequest({
          amount: 10,
          id: 'test'
        })
        expect(request.address).to.equal('ilpdemo.blue.bob.~ipr.ZfiUdFj-tVw.test')
      })

      it('should generate an id if one is not given', function () {
        const request = this.receiver.createRequest({
          amount: 10
        })
        expect(request.address).to.match(/.+[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/)
      })

      it('should set the expiresAt to be 30 seconds if one is not supplied', function () {
        const request = this.receiver.createRequest({
          amount: 10
        })
        expect(request.expires_at).to.equal('1970-01-01T00:00:30.000Z')
      })

      it('should set the data if supplied', function () {
        const request = this.receiver.createRequest({
          amount: 10,
          data: {foo: 'bar'}
        })
        expect(request.data).to.deep.equal({foo: 'bar'})
      })

      it('should not set the data if not supplied', function () {
        const request = this.receiver.createRequest({
          amount: 10
        })
        expect(request).to.not.have.keys('data')
      })

      it('should round up request amounts with too many decimal places if receiver.roundingMode=UP', function * () {
        const receiver = createReceiver({
          client: this.client,
          hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
          roundingMode: 'UP'
        })
        yield receiver.listen()
        const request = receiver.createRequest({
          amount: '10.001'
        })
        expect(request.amount).to.equal('10.01')
      })

      it('should round down request amounts with too many decimal places if receiver.roundRequestAmounts=DOWN', function * () {
        const receiver = createReceiver({
          client: this.client,
          hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
          roundingMode: 'DOWN'
        })
        yield receiver.listen()
        const request = receiver.createRequest({
          amount: '10.001'
        })
        expect(request.amount).to.equal('10')
      })

      it('should round up request amounts with too many decimal places if roundingMode=UP for the payment request', function * () {
        const request = this.receiver.createRequest({
          amount: '10.001',
          roundingMode: 'UP'
        })
        expect(request.amount).to.equal('10.01')
      })

      it('should round down request amounts with too many decimal places if roundingMode=DOWN for the payment request', function * () {
        const request = this.receiver.createRequest({
          amount: '10.001',
          roundingMode: 'DOWN'
        })
        expect(request.amount).to.equal('10')
      })

      it('should give the roundingMode supplied in the createRequest params precedence over the one passed to createReceiver', function * () {
        const receiver = createReceiver({
          client: this.client,
          hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
          roundingMode: 'DOWN'
        })
        yield receiver.listen()
        const request = receiver.createRequest({
          amount: '10.001',
          roundingMode: 'UP'
        })
        expect(request.amount).to.equal('10.01')
      })

      it('should throw an error if rounding would more than double the amount', function * () {
        expect(() => this.receiver.createRequest({
          amount: '0.004',
          roundingMode: 'UP'
        })).to.throw('rounding 0.004 UP would more than double it')
      })

      it('should throw an error if rounding would reduce the amount to zero', function * () {
        expect(() => this.receiver.createRequest({
          amount: '0.004',
          roundingMode: 'DOWN'
        })).to.throw('rounding 0.004 DOWN would reduce it to zero')
      })

      it.skip('should generate the condition from the request details', function () {

      })
    })

    describe('listen', function () {
      it('should reject if the client fails to connect', function (done) {
        const stub = sinon.stub(this.client, 'connect').rejects('some error')
        expect(this.receiver.listen()).to.be.rejected.and.notify(done)
        stub.restore()
      })

      it('should time out if waitForConnection takes too long', function (done) {
        timekeeper.reset()
        const clock = sinon.useFakeTimers(0)
        const stub = sinon.stub(this.client, 'connect').resolves(new Promise((resolve, reject) => {
          setTimeout(resolve, 10001)
        }))
        expect(this.receiver.listen()).to.be.rejected.and.notify(done)
        clock.tick(10000)
        stub.restore()
        clock.restore()
      })

      describe('autoFulfillConditions', function () {
        beforeEach(function * () {
          yield this.receiver.listen()
        })

        it('should ignore outgoing transfers', function * () {
          const results = yield this.client.emitAsync('outgoing_prepare', _.assign(this.transfer, {
            direction: 'outgoing'
          }))
          expect(results).to.deep.equal([])
        })

        it('should ignore transfers with cancellation conditions', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            cancellationCondition: 'ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU?fpt=preimage-sha-256&cost=0'
          }))
          expect(results).to.deep.equal(['cancellation'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject transfers without execution conditions', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            executionCondition: null
          }))
          expect(results).to.deep.equal(['no-execution'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject transfers without ilp packets in the data field', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            data: { not: 'a packet' }
          }))
          expect(results).to.deep.equal(['no-packet'])
          expect(this.client.rejected).to.be.true
        })

        it('should ignore transfers with ilp packets generated by others', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
            data: {
              ilp_header: {
                account: 'for.someone.else'
              }
            }
          }))
          expect(results).to.deep.equal(['not-my-packet'])
          expect(this.client.rejected).to.be.false
        })

        it('should ignore transfers with ilp packets generated by another receiver for the same account', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            data: {
              ilp_header: {
                account:  'ilpdemo.blue.bob.~ipr.aaaaaaaaaaa.22e315dc-3f99-4f89-9914-1987ceaa906d'
              }
            }
          }))
          expect(results).to.deep.equal(['not-my-packet'])
          expect(this.client.rejected).to.be.false
        })

        it('should reject expired packets', function * () {
          timekeeper.freeze(new Date(10000))
          const results = yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
            data: {
              ilp_header: {
                data: {
                  expires_at: '1970-01-01T00:00:01Z'
                }
              }
            }
          }))
          expect(results).to.deep.equal(['expired'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject transfers where the amount is less than specified in the packet', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
            amount: '0.999999999'
          }))
          expect(results).to.deep.equal(['insufficient'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject transfers where the amount is more than requested', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
            amount: '1.0000000001'
          }))
          expect(results).to.deep.equal(['overpayment-disallowed'])
          expect(this.client.rejected).to.be.true
        })

        it('should ignore transfers where the executionCondition does not match the generated condition', function * () {
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            executionCondition: 'ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU?fpt=preimage-sha-256&cost=0'
          }))
          expect(results).to.deep.equal(['condition-mismatch'])
        })

        it('should fulfill the conditions of transfers corresponding to requests generated by the receiver', function * () {
          const request = this.receiver.createRequest({
            amount: 1,
            id: '22e315dc-3f99-4f89-9914-1987ceaa906d',
            data: { for: 'that thing' },
            expiresAt: '1970-01-01T00:00:10Z'
          })
          const results = yield this.client.emitAsync('incoming_prepare', this.transfer)
          expect(results).to.deep.equal(['sent'])
        })

        it('should ignore transfers that don\'t match the original request', function * () {
          const request = this.receiver.createRequest({
            amount: 1,
            id: '22e315dc-3f99-4f89-9914-1987ceaa906d'
          })
          delete this.transfer.data.ilp_header.data
          const results = yield this.client.emitAsync('incoming_prepare', this.transfer)
          expect(results).to.deep.equal(['condition-mismatch'])
        })

        it('should fulfill transfers corresponding to requests with no data included', function * () {
          const request = this.receiver.createRequest({
            amount: 1,
            id: '22e315dc-3f99-4f89-9914-1987ceaa906d',
            expiresAt: this.transfer.data.ilp_header.data.expires_at
          })
          delete this.transfer.data.ilp_header.data.data
          this.transfer.executionCondition = request.condition
          const results = yield this.client.emitAsync('incoming_prepare', this.transfer)
          expect(results).to.deep.equal(['sent'])
        })

        it('should allow overpayment if allowOverPayment is set', function * () {
          const receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
            allowOverPayment: true
          })
          yield receiver.listen()
          const results = yield this.client.emitAsync('incoming_prepare', _.assign(this.transfer, {
            amount: '10000000000000' // a bit excessive, i know
          }))
          // because we're instantiating an extra receiver there will actually be two events
          expect(results).to.contain('sent')
        })

        it('should handle trailing zeros in the packet amount', function * () {
          const request = this.receiver.createRequest({
            amount: 1,
            id: '22e315dc-3f99-4f89-9914-1987ceaa906d',
            expiresAt: this.transfer.data.ilp_header.data.expires_at
          })
          const results = yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
            data: {
              ilp_header: {
                amount: '1.00'
              }
            }
          }))
          expect(results).to.contain('sent')
        })

        it('should not reject an incoming transfer created by another receiver', function * () {
          const spy = sinon.spy(this.client.plugin, 'rejectIncomingTransfer')
          const otherReceiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('h2hvT7sCIvPEq4mSCTcuCYN7uoG/VIJ7XiI7Ok0acxw=')
          })
          yield otherReceiver.listen()
          const results = yield this.client.emitAsync('incoming_prepare', this.transfer)
          expect(spy).not.to.have.been.called
        })

        it('should reject the transfer if reviewPayment callback rejects', function * () {
          this.receiver.stopListening()
          const receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
            reviewPayment: (transfer, paymentRequest) => {
              console.log('i was called')
              return Promise.reject(new Error('rejected!'))
            }
          })
          yield receiver.listen()

          const request = receiver.createRequest({
            amount: 1,
            id: '22e315dc-3f99-4f89-9914-1987ceaa906d',
            expiresAt: this.transfer.data.ilp_header.data.expires_at,
            data: { for: 'that thing' }
          })

          this.transfer.executionCondition = request.condition
          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.deep.equal(['rejected-by-receiver: Error: rejected!'])
          expect(this.client.rejected).to.be.true
        })

      })

      describe('autoFulfillConditions - PSK', function () {
        beforeEach(function * () {
          this.receiver.stopListening()
          this.receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
            // reviewPayment is required for PSK
            reviewPayment: () => {}
          })
        })

        afterEach(function * () {
          yield this.receiver.stopListening()
        })

        it('should reject PSK payment without reviewPayment', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          this.receiver.stopListening()
          const receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64')
          })
          yield receiver.listen()
          const psk = receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1",
            data: { for: 'that thing' }
          }))

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.deep.equal(['psk-not-supported'])
          expect(this.client.rejected).to.be.true
        })

        it('should not fulfill PSK payment with invalid ciphertext blob', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          const request = {
            address: 'ilpdemo.blue.bob.~psk.ZfiUdFj-tVw.nRipWUSjnJMDU0zdCM4yKQ.blah',
            amount: '1',
            expires_at: '1970-01-01T00:00:30.000Z',
            data: { blob: 'invalid' },
            condition: 'ni:///sha-256;QXcyj2zzwg4rbokeaPl2gduahxCVeSkFf_yLRvsDBMs?fpt=preimage-sha-256&cost=32'
          }

          yield this.receiver.listen()

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.deep.equal(['psk-corrupted-data'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject a PSK payment that has been tampered with', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          yield this.receiver.listen()

          const psk = this.receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1",
            data: { for: 'that thing' }
          }))

          this.transfer.amount = 0.5
          this.transfer.data.ilp_header.amount = 0.5
          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.deep.equal(['condition-mismatch'])
        })

        it('should reject PSK payments with unencrypted memos', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          yield this.receiver.listen()

          const request = {
            address: 'ilpdemo.blue.bob.~psk.ZfiUdFj-tVw.nRipWUSjnJMDU0zdCM4yKQ.blah',
            amount: '1',
            expires_at: '1970-01-01T00:00:30.000Z',
            data: { for: 'that thing' },
            condition: 'ni:///sha-256;apu2Eku6790mNC8ZQ4lYxbkR93VO3rNSMNO5gZYh0po?fpt=preimage-sha-256&cost=32'
          }

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.deep.equal(['psk-data-must-be-encrypted-blob'])
          expect(this.client.rejected).to.be.true
        })

        it('should reject payments if reviewPayment throws an error', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          this.receiver.stopListening()
          const receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
            reviewPayment: () => { throw new Error('uh oh!') }
          })
          yield receiver.listen()

          const psk = receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1",
            data: { for: 'that thing' }
          }))

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.be.deep.equal(['rejected-by-receiver: Error: uh oh!'])
        })

        it('should reject payments if reviewPayment rejects', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          this.receiver.stopListening()
          const receiver = createReceiver({
            client: this.client,
            hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
            reviewPayment: () => { return Promise.reject(new Error('uh oh!')) }
          })
          yield receiver.listen()

          const psk = receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1",
            data: { for: 'that thing' }
          }))

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.be.deep.equal(['rejected-by-receiver: Error: uh oh!'])
        })
        it('should fulfill PSK payments', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          yield this.receiver.listen()

          const psk = this.receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1",
            data: { for: 'that thing' }
          }))

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = request.data

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.be.deep.equal(['sent'])
        })

        it('should fulfill PSK payments that don\'t have data attached', function * () {
          const sender = createSender({
            client: new MockClient({}),
            uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
          })

          yield this.receiver.listen()

          const psk = this.receiver.generatePskParams()
          const request = sender.createRequest(Object.assign({}, psk, {
            destinationAmount: "1"
          }))

          this.transfer.account = request.address
          this.transfer.executionCondition = request.condition
          this.transfer.data.ilp_header.data.expires_at = request.expires_at
          this.transfer.data.ilp_header.account = request.address
          this.transfer.data.ilp_header.data.data = null

          yield expect(this.client.emitAsync('incoming_prepare', this.transfer))
            .to.eventually.be.deep.equal(['sent'])
        })
      })
    })

    describe('stopListening', function () {
      it('should remove listeners and disconnect the client', function () {
        const spy = sinon.spy(this.client, 'disconnect')
        this.receiver.stopListening()
        expect(this.client.listeners('incoming_prepare')).to.have.lengthOf(0)
        expect(spy).to.have.been.calledOnce
      })
    })

    describe('events', function () {
      beforeEach(function * () {
        yield this.receiver.listen()
      })

      it('should emit `incoming` when a transfer is fulfilled and money received', function * () {
        let emitted = false
        this.receiver.on('incoming', (transfer, fulfillment) => {
          expect(transfer).to.be.a('object')
          expect(fulfillment).to.be.a('string')
          emitted = true
        })
        yield this.client.emitAsync('incoming_prepare', this.transfer)
        expect(emitted).to.be.true
      })

      it('should emit `incoming:<request id>` when a specific payment request is fulfilled', function * () {
        let emitted = false
        this.receiver.on('incoming:22e315dc-3f99-4f89-9914-1987ceaa906d', (transfer, fulfillment) => {
          expect(transfer).to.be.a('object')
          expect(fulfillment).to.be.a('string')
          emitted = true
        })
        yield this.client.emitAsync('incoming_prepare', this.transfer)
        expect(emitted).to.be.true
      })

      it('should allow wildcard events for multi-level request ids', function * () {
        let emitted = false
        this.receiver.on('incoming:someapp.*', (transfer, fulfillment) => {
          expect(transfer).to.be.a('object')
          expect(fulfillment).to.be.a('string')
          emitted = true
        })
        yield this.client.emitAsync('incoming_prepare', _.merge(this.transfer, {
          data: {
            ilp_header: {
              account: 'ilpdemo.blue.bob.~ipr.ZfiUdFj-tVw.someapp.requestid'
            }
          },
          executionCondition: 'ni:///sha-256;fRifMsPe8L0xpCQSuv51QNj0ZO1H5t0-Aer4ZhLYFEE?fpt=preimage-sha-256&cost=32'
        }))
        expect(emitted).to.be.true
      })
    })
  })
})
