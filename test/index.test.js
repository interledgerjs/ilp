'use strict'

const expect = require('chai').expect
const index = require('..')

describe('Index', function () {
  it('should export ILDCP, SPSP, STREAM, createLogger, and getPlugin functionality', function () {
    expect(index.ILDCP).to.be.an('object')
    expect(index.SPSP).to.be.an('object')
    expect(index.STREAM).to.be.an('object')
    expect(index.createLogger).to.be.a('function')
    expect(index.getPlugin).to.be.a('function')
  })
})
