'use strict'

const chai = require('chai')
const assert = chai.assert
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
require('sinon-as-promised')
chai.use(sinonChai)
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const timekeeper = require('timekeeper')
const _ = require('lodash')
const mockRequire = require('mock-require')
const CustomError = require('custom-error-instance')

const createSender = require('../src/lib/sender').createSender
const MockClient = require('./mocks/mockCore').Client
const paymentRequest = require('./data/paymentRequest.json')
const paymentParams = require('./data/paymentParams.json')
const cryptoHelper = require('../src/utils/crypto')

describe('Sender Module', function () {
  beforeEach(function () {
    this.client = new MockClient({})
    timekeeper.freeze(new Date(0))
  })

  afterEach(function () {
    timekeeper.reset()
  })

  describe('createRequest', function () {
    beforeEach(function () {
      this.sender = createSender({
        client: this.client,
        uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
      })
      this.psk = {
        destinationAccount: 'ilpdemo.blue.bob.~psk.ZfiUdFj-tVw.HHxfobwe-sscE5rKUrCksA',
        sharedSecret: '8qAZtXsrK8Lz_BTSv4D2zA'
      }
    })

    it('should generate a payment request', function () {
      const request = this.sender.createRequest(Object.assign({}, this.psk, {
        destinationAmount: '1'
      }))

      assert.match(request.address, new RegExp('^' + this.psk.destinationAccount))
      assert.equal(request.amount, '1')
      assert.equal(request.expires_at, '1970-01-01T00:00:30.000Z')
    })

    it('should encrypt the payment request data and store as a base64-encoded blob', function () {
      const secretData = {
        secret: {
          secret1: 'secret',
          secret2: 'secret too'
        }
      }

      const request = this.sender.createRequest(Object.assign({}, this.psk, {
        destinationAmount: '1',
        data: secretData
      }))

      assert.deepEqual(
        cryptoHelper.aesDecryptObject(
          Buffer.from(request.data.blob, 'base64'),
          Buffer.from(this.psk.sharedSecret, 'base64')
        ),
        secretData)
    })
  })

  describe('createSender', function () {
    it('should return an object with the `quoteRequest` and `payRequest` functions', function () {
      const sender = createSender({
        client: this.client,
        uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
      })
      expect(sender).to.be.a('object')
      expect(sender.quoteRequest).to.be.a('function')
      expect(sender.payRequest).to.be.a('function')
      expect(sender.quoteSourceAmount).to.be.a('function')
      expect(sender.quoteDestinationAmount).to.be.a('function')
    })

    it('should instantiate a new ilp-core Client if one is not supplied', function () {
      const stub = sinon.stub().returns({})
      const fakePlugin = function () {}
      mockRequire('ilp-core', {
        Client: stub
      })
      const createSenderWithMock = mockRequire.reRequire('../src/lib/sender').createSender
      createSenderWithMock({
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

    it('should allow an array of connectors to be supplied', function () {
      const connectors = [{
        id: 'https://blue.ilpdemo.org/ledger/accounts/connie',
        name: 'connie',
        connector: 'https://someconnector.example',
      }]
      const stub = sinon.stub().returns({})
      const fakePlugin = function () {}
      mockRequire('ilp-core', {
        Client: stub
      })
      const createSenderWithMock = mockRequire.reRequire('../src/lib/sender').createSender
      createSenderWithMock({
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64'),
        plugin: fakePlugin,
        auth: { some: 'auth' },
        connectors: connectors
      })
      expect(stub).to.have.been.calledOnce
      expect(stub).to.have.been.calledWithMatch({}, {
        connectors: connectors
      })
      mockRequire.stop('ilp-core')
    })
  })

  describe('Sender', function () {
    beforeEach(function () {
      this.paymentParams = _.cloneDeep(paymentParams)
      this.sender = createSender({
        client: this.client,
        uuidSeed: Buffer.from('f73e2739c0f0ff4c9b7cac6678c89a59ee6cb8911b39d39afbf2fef9e77bc9c3', 'hex')
      })
    })

    describe('quoteRequest', function () {
      beforeEach(function () {
        this.paymentRequest = _.cloneDeep(paymentRequest)
        this.quoteStub = sinon.stub(this.client, 'quote')
        this.quoteStub.withArgs(sinon.match({
          destinationAddress: sinon.match(/^ilpdemo\.blue\.bob\./),
          destinationAmount: '1'
        })).resolves({
          connectorAccount: 'https://blue.ilpdemo.org/ledger/accounts/connie',
          sourceAmount: '2'
        })
      })

      afterEach(function () {
        this.quoteStub.restore()
      })

      it.skip('should quote using the destination precision and scale provided in the request', function () {

      })

      it.skip('should reject if the hold time is greater than the maxHoldDuration', function () {

      })

      it('should reject if there is no address', function (done) {
        expect(this.sender.quoteRequest(_.assign(this.paymentRequest, {
          address: null
        }))).to.be.rejectedWith('Malformed payment request: no address').notify(done)
      })

      it('should reject if there is no amount', function (done) {
        expect(this.sender.quoteRequest(_.assign(this.paymentRequest, {
          amount: null
        }))).to.be.rejectedWith('Malformed payment request: no amount').notify(done)
      })

      it('should reject if there is no execution condition', function (done) {
        expect(this.sender.quoteRequest(_.assign(this.paymentRequest, {
          condition: null
        }))).to.be.rejectedWith('Malformed payment request: no condition').notify(done)
      })

      it('should accept a payment request generated by the Receiver', function * () {
        const result = yield this.sender.quoteRequest(this.paymentRequest)
        expect(result).to.be.ok
        expect(this.quoteStub).to.have.been.calledOnce
      })

      it('should resolve to valid parameters for payRequest', function * () {
        const result = yield this.sender.quoteRequest(this.paymentRequest)
        expect(result).to.deep.equal(this.paymentParams)
      })

      it('should reject if the there is an error with the quote', function * () {
        this.quoteStub.restore()
        const stub = sinon.stub(this.client, 'quote').rejects('Some error')
        let error
        try {
          yield this.sender.quoteRequest(this.paymentRequest)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Some error')
        stub.restore()
      })

      it('should reject if the quote response from the connector is empty', function * () {
        this.quoteStub.restore()
        const stub = sinon.stub(this.client, 'quote').resolves(null)
        let error
        try {
          yield this.sender.quoteRequest(this.paymentRequest)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Got empty quote response from the connector')
        stub.restore()
      })
    })

    describe('quoteDestinationAmount', function () {
      it('should reject if no address is given', function * () {
        let error
        try {
          yield this.sender.quoteDestinationAmount(10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Must provide destination address')
      })

      it('should reject if no amount is given', function * () {
        let error
        try {
          yield this.sender.quoteDestinationAmount('ilpdemo.blue.bob')
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Must provide destination amount')
      })

      it('should reject if the there is an error with the quote', function * () {
        const stub = sinon.stub(this.client, 'quote').rejects('Some error')
        let error
        try {
          yield this.sender.quoteDestinationAmount('ilpdemo.blue.bob', 10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Some error')
        stub.restore()
      })

      it('should reject if the quote response from the connector is empty', function * () {
        const stub = sinon.stub(this.client, 'quote').resolves(null)
        let error
        try {
          yield this.sender.quoteDestinationAmount('ilpdemo.blue.bob', 10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Got empty quote response from the connector')
        stub.restore()
      })

      it('should resolve to the source amount', function * () {
        const quoteStub = sinon.stub(this.client, 'quote')
        quoteStub.withArgs({
          destinationAddress: 'ilpdemo.blue.bob',
          destinationAmount: '10'
        }).resolves({ sourceAmount: '15.50' })
        const sourceAmount = yield this.sender.quoteDestinationAmount('ilpdemo.blue.bob', 10)
        expect(sourceAmount).to.equal('15.50')
      })
    })

    describe('quoteSourceAmount', function () {
      it('should reject if no address is given', function * () {
        let error
        try {
          yield this.sender.quoteSourceAmount(10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Must provide destination address')
      })

      it('should reject if no amount is given', function * () {
        let error
        try {
          yield this.sender.quoteSourceAmount('ilpdemo.blue.bob')
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Must provide source amount')
      })

      it('should reject if the there is an error with the quote', function * () {
        const stub = sinon.stub(this.client, 'quote').rejects('Some error')
        let error
        try {
          yield this.sender.quoteSourceAmount('ilpdemo.blue.bob', 10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Some error')
        stub.restore()
      })

      it('should reject if the quote response from the connector is empty', function * () {
        const stub = sinon.stub(this.client, 'quote').resolves(null)
        let error
        try {
          yield this.sender.quoteSourceAmount('ilpdemo.blue.bob', 10)
        } catch (e) {
          error = e
        }
        expect(error).to.be.ok
        expect(error.message).to.equal('Got empty quote response from the connector')
        stub.restore()
      })

      it('should resolve to the destination amount', function * () {
        const quoteStub = sinon.stub(this.client, 'quote')
        quoteStub.withArgs({
          destinationAddress: 'ilpdemo.blue.bob',
          sourceAmount: '10'
        }).resolves({ destinationAmount: '15.50' })
        const destinationAmount = yield this.sender.quoteSourceAmount('ilpdemo.blue.bob', 10)
        expect(destinationAmount).to.equal('15.50')
      })
    })

    describe('payRequest', function () {
      it('should accept the output of quoteRequest', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => this.client.emit('outgoing_fulfill', {
            executionCondition: this.paymentParams.executionCondition
          }, 'fulfillment'))
          resolve()
        }))
        const result = yield this.sender.payRequest(this.paymentParams)
        expect(result).to.be.ok
        expect(stub).to.have.been.calledWith(this.paymentParams)
      })

      it('should resolve to the transfer\'s condition fulfillment when the fulfillment is ready immediately', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment', (transfer) => Promise.resolve(transfer))
        const stub2 = sinon.stub(this.client.getPlugin(), 'getFulfillment')
        stub2.resolves('fulfillment')
        const fulfillment = yield this.sender.payRequest(this.paymentParams)
        expect(fulfillment).to.equal('fulfillment')
        expect(stub).to.be.calledOnce
        expect(stub2).to.be.calledOnce
      })

      it('should resolve to the transfer\'s condition fulfillment when the fulfillment is emitted as an event', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => this.client.emit('outgoing_fulfill', {
            executionCondition: this.paymentParams.executionCondition
          }, 'fulfillment'))
          resolve()
        }))
        const fulfillment = yield this.sender.payRequest(this.paymentParams)
        expect(fulfillment).to.equal('fulfillment')
        expect(stub).to.be.calledOnce
      })

      it('should reject if the transfer times out', function * () {
        timekeeper.reset()
        const clock = sinon.useFakeTimers(0)
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(Promise.resolve().then(() => {
          setImmediate(() => clock.tick(10000))
        }))
        // clock is restored before end because of https://github.com/sinonjs/sinon/issues/738
        clock.restore()
        try {
          yield this.sender.payRequest(this.paymentParams)
        } catch (e) {
          expect(e.message).to.equal('Transfer expired, money returned')
        }
      })

      it('should reject if client.sendQuotedPayment rejects', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.rejects(new Error('something went wrong'))
        let error
        try {
          yield this.sender.payRequest(this.paymentParams)
        } catch (e) {
          error = e
        }
        expect(error.message).to.equal('something went wrong')
      })

      it('should remove the listener on the client if the transfer times out', function * () {
        timekeeper.reset()
        const clock = sinon.useFakeTimers(0)
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(Promise.resolve().then(() => {
          setImmediate(() => clock.tick(10000))
        }))
        // clock is restored before end because of https://github.com/sinonjs/sinon/issues/738
        clock.restore()
        try {
          yield this.sender.payRequest(this.paymentParams)
        } catch (e) {
        }
        expect(this.client.listeners('outgoing_fulfill')).to.have.lengthOf(0)
      })

      it('should resolve only when the transfer with the right condition is fulfilled', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => {
            return this.client.emitAsync('outgoing_fulfill', {
              executionCondition: 'some-other-condition'
            }, 'not-the-right-fulfillment')
            .then(() => {
              return this.client.emitAsync('outgoing_fulfill', {
                executionCondition: this.paymentParams.executionCondition
              }, 'correct-fulfillment')
            })
          })
          resolve()
        }))
        const fulfillment = yield this.sender.payRequest(this.paymentParams)
        expect(fulfillment).to.equal('correct-fulfillment')
        expect(stub).to.be.calledOnce
      })

      it('should not leave listeners on the client once the fulfillment has been received', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => this.client.emit('outgoing_fulfill', {
            executionCondition: this.paymentParams.executionCondition
          }, 'fulfillment'))
          resolve()
        }))
        yield this.sender.payRequest(this.paymentParams)
        expect(this.client.listeners('outgoing_fulfill')).to.have.lengthOf(0)
      })

      it('should use a deterministic transfer id to make payment idempotent', function * () {
        const spy = sinon.spy(this.client, 'sendQuotedPayment')
        this.sender.payRequest(this.paymentParams)
        this.sender.payRequest(this.paymentParams)
        yield Promise.resolve()
        expect(spy).to.have.always.been.calledWithMatch({
          uuid: '3781904f-051d-4d39-8eb2-18cd1661d7c7'
        })
      })

      it('should return the fulfillment even when the payment is a duplicate but the original has not yet been fulfilled', function * () {
        const DuplicateIdError = CustomError('DuplicateIdError', { message: 'Duplicate id' })
        const MissingFulfillmentError = CustomError('MissingFulfillmentError', { message: 'Missing fulfillment' })

        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.onFirstCall().resolves(new Promise((resolve) => {
            setImmediate(() => this.client.emit('outgoing_fulfill', {
              executionCondition: this.paymentParams.executionCondition
            }, 'fulfillment'))
            resolve()
          }))
        stub.onSecondCall().rejects(DuplicateIdError('id has already been used'))
        const fulfillmentStub = sinon.stub(this.client.plugin, 'getFulfillment')
          .rejects(MissingFulfillmentError('not yet fulfilled'))

        const results = yield Promise.all([
          this.sender.payRequest(this.paymentParams),
          this.sender.payRequest(this.paymentParams)
        ])
        expect(stub).to.be.calledTwice
        expect(fulfillmentStub).to.be.calledTwice
        expect(results).to.deep.equal(['fulfillment', 'fulfillment'])
      })

      it('should return the fulfillment even when the payment is a duplicate and the original has already been fulfilled', function * () {
        const DuplicateIdError = CustomError('DuplicateIdError', { message: 'Duplicate id' })

        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.onFirstCall().resolves(new Promise((resolve) => {
            setImmediate(() => this.client.emit('outgoing_fulfill', {
              executionCondition: this.paymentParams.executionCondition
            }, 'fulfillment'))
            resolve()
          }))
        stub.onSecondCall().rejects(DuplicateIdError('id has already been used'))
        const fulfillmentStub = sinon.stub(this.client.plugin, 'getFulfillment')
          .resolves('fulfillment')

        const results = yield Promise.all([
          this.sender.payRequest(this.paymentParams),
          this.sender.payRequest(this.paymentParams)
        ])
        expect(stub).to.be.calledTwice
        expect(fulfillmentStub).to.be.calledTwice
        expect(results).to.deep.equal(['fulfillment', 'fulfillment'])
      })

      it('should reject if the payment is a duplicate but getting the fulfillment fails', function * () {
        const DuplicateIdError = CustomError('DuplicateIdError', { message: 'Duplicate id' })

        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.rejects(DuplicateIdError('id has already been used'))
        const fulfillmentStub = sinon.stub(this.client.plugin, 'getFulfillment')
          .rejects(new Error('something bad happened'))

        let error
        try {
          yield this.sender.payRequest(this.paymentParams)
        } catch (e) {
          error = e
        }
        expect(error.message).to.equal('something bad happened')
        expect(stub).to.be.calledOnce
        expect(fulfillmentStub).to.be.calledOnce
      })
    })

    describe('stopListening', function () {
      it('should disconnect the client', function () {
        const spy = sinon.spy(this.client, 'disconnect')
        this.sender.stopListening()
        expect(spy).to.have.been.calledOnce
      })
    })
  })
})
