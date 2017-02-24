'use strict'

const expect = require('chai').expect
const index = require('..')

describe('Index', function () {
  it('should export ILQP, SPSP, IPR, and PSK functionality', function () {
    expect(index.ILQP).to.be.an('object')
    expect(index.SPSP).to.be.an('object')
    expect(index.IPR).to.be.an('object')
    expect(index.PSK).to.be.an('object')
  })
})
