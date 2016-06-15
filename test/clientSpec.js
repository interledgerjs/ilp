'use strict'
/* global describe it beforeEach afterEach */

const _ = require('lodash')
const chai = require('chai')
const expect = chai.expect
const mockRequire = require('mock-require')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
chai.use(sinonChai)

const MockCore = require('./mocks/mock-core')
mockRequire('ilp-core', MockCore)
const Client = require('../src/lib/client')
const PaymentRequest = require('../src/lib/request')

const FAKE_TIME = 0

describe('Client', function () {
  describe('constructor', function () {
    it('should instantiate an ilp-core client', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      expect(client).to.be.instanceof(Client)
      expect(client.coreClient).to.be.instanceof(MockCore.Client)
    })

    it('should default to ledgerType: "five-bells"', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      expect(client.coreClient.type).to.equal('bells')
    })

    it('should default to a maxSourceHoldDuration of 10 seconds', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      expect(client.maxSourceHoldDuration).to.equal(10)
    })

    it('should throw an error if the ledgerType is unknown', function () {
      expect(() => new Client({
        ledgerType: 'fake',
        auth: {}
      })).to.throw('Cannot find module \'ilp-plugin-fake\'')
    })

    it('should generate a random conditionHashlockSeed if none is provided', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      expect(Buffer.isBuffer(client.conditionHashlockSeed)).to.be.true
    })

    it('should throw an error if the conditionHashlockSeed is not a buffer', function () {
      expect(() => new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        },
        conditionHashlockSeed: 'hello world'
      })).to.throw('conditionHashlockSeed must be a Buffer')
    })
  })

  describe('connect', function () {
    it('should connect using the ilp-core client', function (done) {
      const connect = sinon.spy(MockCore.Client.prototype, 'connect')

      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })
      client.connect().then(() => {
        expect(connect).to.be.calledOnce
        connect.restore()
        done()
      })
    })

    it('should reject if there is a connection error with the ilp-core client', function (done) {
      const waitForConnection = sinon.stub(MockCore.Client.prototype, 'waitForConnection')
        .returns(Promise.reject(new Error('connection error')))

      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })
      client.connect()
        .then(() => done(new Error('should reject')))
        .catch((err) => {
          expect(err.message).to.equal('connection error')
          expect(waitForConnection).to.be.calledOnce
          waitForConnection.restore()
          done()
        })
    })

    it('should not query the ilp-core client for the account if the client already knows it', function (done) {
      const getPlugin = sinon.spy(MockCore.Client.prototype, 'getPlugin')

      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })
      client.connect().then(() => {
        return client.connect().then(() => {
          // once for getAccount, once for getLedger (but no more than twice)
          expect(getPlugin).to.be.calledTwice
          getPlugin.restore()
          done()
        })
      })
      .catch(done)
    })
  })

  describe('quote', function () {
    it('should return the sourceAmount for a fixed destinationAmount', function (done) {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      client.quote({
        destinationAmount: '10',
        destinationAccount: 'https://other-ledger.example/accounts/bob',
        destinationLedger: 'https://other-ledger.example'
      }).then((quote) => {
        expect(quote.sourceAmount).to.equal('10')
        done()
      })
    })
  })

  describe('send', function () {
    beforeEach(function () {
      this.sandbox = sinon.sandbox.create()
      this.client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })
    })

    afterEach(function () {
      this.sandbox.restore()
    })

    it('should require a maxSourceAmount', function () {
      expect(() => this.client.send({
        destinationAccount: 'https://ledger.example/accounts/bob',
        destinationAmount: '10',
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0'
      })).to.throw('maxSourceAmount is required')
    })

    it('should require an executionCondition unless unsafeOptimisticTransport is true', function () {
      expect(() => this.client.send({
        destinationAccount: 'https://ledger.example/accounts/bob',
        destinationAmount: '10',
        maxSourceAmount: '10'
      })).to.throw('executionCondition is required unless unsafeOptimisticTransport is set to true')
    })

    it('should create a payment, quote it, send it and return a Promise', function (done) {
      const quote = this.sandbox.spy(MockCore.Payment.prototype, 'quote')
      const sendQuoted = this.sandbox.spy(MockCore.Payment.prototype, 'sendQuoted')
      const createPayment = this.sandbox.spy(MockCore.Client.prototype, 'createPayment')

      const result = this.client.send({
        destinationAccount: 'https://ledger.example/accounts/bob',
        destinationAmount: '10',
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        maxSourceAmount: '10'
      })
      expect(result).to.be.instanceof(Promise)
      result.then(() => {
        expect(createPayment).to.be.calledOnce
        expect(quote).to.be.calledOnce
        expect(sendQuoted).to.be.calledOnce
        done()
      })
    })

    it('should reject if the quote exceeds the maxSourceAmount', function (done) {
      this.client.send({
        destinationAccount: 'https://ledger.example/accounts/bob',
        destinationAmount: '10',
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        maxSourceAmount: '9'
      }).then(() => {
        done(new Error('should reject'))
      }).catch((err) => {
        expect(err.message).to.match(/Transfer source amount \(\d*\.?\d+\) would exceed maxSourceAmount \(\d*\.?\d+\)/)
        done()
      })
    })

    it.skip('should reject if the client does not connect before the expiresAt time', function () {

    })

    it('should reject if the quoted hold duration exceeds the maxSourceHoldDuration', function (done) {
      this.client.send({
        destinationAccount: 'https://ledger.example/accounts/bob',
        destinationAmount: '10',
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        maxSourceAmount: '10',
        maxSourceHoldDuration: '9'
      }).then(() => {
        done(new Error('should reject'))
      }).catch((err) => {
        expect(err.message).to.match(/Source transfer hold duration \(\d*\.?\d+\) would exceed maxSourceHoldDuration \(\d*\.?\d+\)/)
        done()
      })
    })
  })

  describe('createRequest', function () {
    it('should throw an error if the client is not connected', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      // (user must call client.connect() first)

      expect(() => client.createRequest({
        destinationAmount: '10'
      })).to.throw('Client must be connected before it can create a PaymentRequest')
    })

    it('should return a PaymentRequest with the account and ledger filled in from the client', function (done) {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })
      client.connect()
        .then(() => {
          const paymentRequest = client.createRequest({
            destinationAmount: '10'
          })
          expect(paymentRequest).to.be.instanceof(PaymentRequest)
          expect(paymentRequest.destinationAccount).to.equal('https://ledger.example/accounts/alice')
          expect(paymentRequest.destinationLedger).to.equal('https://ledger.example')
          done()
        })
    })
  })

  describe('parseRequest', function () {
    it('should return a PaymentRequest', function () {
      const client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        }
      })

      const request = { account: 'https://ledger.example/accounts/alice',
        ledger: 'https://ledger.example',
        amount: '10',
        data: {
          id: '3cb34c81-5104-415d-8be8-138a22158a48',
          expiresAt: '2016-06-06T03:07:43.655Z'
        }
      }

      expect(client.parseRequest(request)).to.be.instanceof(PaymentRequest)
    })
  })

  describe('_handleReceive', function () {
    beforeEach(function () {
      this.clock = sinon.useFakeTimers(FAKE_TIME)
      this.client = new Client({
        auth: {
          account: 'https://ledger.example/accounts/alice',
          password: 'alice'
        },
        conditionHashlockSeed: Buffer.from('secret', 'utf8')
      })

      this.incomingTransfer = {
        id: 'e99af93f-8c97-4f7f-bcfd-e1beef847c4f',
        direction: 'incoming',
        ledger: 'https://ledger.example',
        account: 'https://ledger.example/accounts/alice',
        amount: '10',
        executionCondition: 'cc:0:3:L6R-TUf1S-PHh8sUKFTQ8LT75DC6JByKsl0IM5OfF98:32',
        data: {
          ilp_header: {
            ledger: 'https://ledger.example',
            account: 'https://ledger.example/accounts/alice',
            amount: '10',
            data: {
              id: '3cb34c81-5104-415d-8be8-138a22158a48',
              expiresAt: '1970-01-01T00:00:01.000Z',
              executionCondition: 'cc:0:3:L6R-TUf1S-PHh8sUKFTQ8LT75DC6JByKsl0IM5OfF98:32',
              destinationMemo: {
                foo: 'bar'
              }
            }
          }
        }
      }
    })

    afterEach(function () {
      this.clock.restore()
    })

    it('should disregard outgoing transfers', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.assign({}, this.incomingTransfer, {
        direction: 'outgoing'
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers with cancellationConditions', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.assign({}, this.incomingTransfer, {
        cancellationCondition: 'cc:0:'
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers with executionConditions but no ilp packet in the data field', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.assign({}, this.incomingTransfer, {
        data: {
          ilp_header: null,
          other_thing: {
            foo: 'bar '
          }
        }
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers where the amount does not match the ilp packet amount', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.assign({}, this.incomingTransfer, {
        amount: '9.99'
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers where the packet has an invalid expiresAt', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.merge({}, this.incomingTransfer, {
        data: {
          ilp_header: {
            data: {
              expiresAt: 'not a date'
            }
          }
        }
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers where packet has expired', function (done) {
      this.clock = sinon.useFakeTimers(FAKE_TIME + 10000)
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', this.incomingTransfer)
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers where the transfer condition does not match the packet condition', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.assign({}, this.incomingTransfer, {
        executionCondition: 'cc:3:11:Mjmrcm06fOo-3WOEZu9YDSNfqmn0lj4iOsTVEurtCdI:518'
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should disregard transfers where the fulfillment generated does not match the transfer executionCondition', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('incoming', () => {
        done(new Error('should disregard'))
      })
      this.client.coreClient.emit('receive', _.merge({}, this.incomingTransfer, {
        data: {
          ilp_header: {
            data: {
              destinationMemo: {
                something: 'extra'
              }
            }
          }
        }
      }))
      process.nextTick(() => {
        expect(spy).to.have.not.been.called
        spy.restore()
        done()
      })
    })

    it('should emit an `incoming` event for a transfer without a condition', function (done) {
      const incomingTransfer = _.assign({}, this.incomingTransfer, {
        executionCondition: null
      })
      this.client.on('incoming', (transfer) => {
        expect(transfer).to.deep.equal(incomingTransfer)
        done()
      })
      this.client.on('error', done)
      this.client.coreClient.emit('receive', incomingTransfer)
    })

    it('should emit an `incoming` event for a transfer without a condition even if the packet is expired', function (done) {
      this.clock = sinon.useFakeTimers(FAKE_TIME + 10000)
      const incomingTransfer = _.assign({}, this.incomingTransfer, {
        executionCondition: null
      })
      this.client.on('incoming', (transfer) => {
        expect(transfer).to.deep.equal(incomingTransfer)
        done()
      })
      this.client.on('error', done)
      this.client.coreClient.emit('receive', incomingTransfer)
    })


    it('should automatically fulfill transfers for which it can generate the executionCondition fulfillment', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('error', done)
      this.client.coreClient.emit('receive', this.incomingTransfer)
      process.nextTick(() => {
        expect(spy).to.have.been.calledOnce
        expect(spy).to.have.been.calledWith('e99af93f-8c97-4f7f-bcfd-e1beef847c4f', 'cf:0:VSoU2V9QUOeGFoy_zEI2bD3e5xBH9-BocwvuGIwFOxI')
        spy.restore()
        done()
      })
    })

    it('should use the executionCondition from the transfer if none is given in the packet', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('error', done)
      this.client.coreClient.emit('receive', _.merge({}, this.incomingTransfer, {
        data: {
          ilp_header: {
            data: {
              executionCondition: null
            }
          }
        }
      }))
      process.nextTick(() => {
        expect(spy).to.have.been.calledOnce
        expect(spy).to.have.been.calledWith('e99af93f-8c97-4f7f-bcfd-e1beef847c4f', 'cf:0:VSoU2V9QUOeGFoy_zEI2bD3e5xBH9-BocwvuGIwFOxI')
        spy.restore()
        done()
      })
    })

    it('should not care if the packet has no expiresAt', function (done) {
      const spy = sinon.spy(this.client.coreClient, 'fulfillCondition')
      this.client.on('error', done)
      const condition = 'cc:0:3:CilvT5hsCgNGvOMpTNihQRLbPDSQty9e1Zykn5OAqrs:32'
      this.client.coreClient.emit('receive', _.merge({}, this.incomingTransfer, {
        executionCondition: condition,
        data: {
          ilp_header: {
            data: {
              expiresAt: null,
              executionCondition: condition
            }
          }
        }
      }))
      process.nextTick(() => {
        expect(spy).to.have.been.calledOnce
        spy.restore()
        done()
      })
    })

    it('should emit an error if there is an error when submitting the condition fulfillment', function (done) {
      const spy = sinon.stub(this.client.coreClient, 'fulfillCondition')
        .returns(Promise.reject(new Error('some error')))
      this.client.on('incoming', (transfer) => done(new Error('should error')))
      this.client.on('error', (err) => {
        expect(err).to.be.ok
        expect(spy).to.have.been.called
        spy.restore()
        done()
      })
      this.client.coreClient.emit('receive', this.incomingTransfer)
    })
  })
})
