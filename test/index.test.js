'use strict'

const expect = require('chai').expect
const ilp = require('..')

describe('Index', function () {
  it('should export ILDCP, SPSP, STREAM and utility functions', function () {
    expect(ilp.ILDCP).to.be.an('object')
    expect(ilp.SPSP).to.be.an('object')
    expect(ilp.STREAM).to.be.an('object')
    expect(ilp.createLogger).to.be.a('function')
    expect(ilp.createPlugin).to.be.a('function')
    expect(ilp.receive).to.be.a('function')
    expect(ilp.pay).to.be.a('function')
  })
})
