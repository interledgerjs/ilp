'use strict'

const expect = require('chai').expect

const index = require('..')

describe('Index', function () {
  it('should export the createReceiver and createSender functions', function () {
    expect(index.createReceiver).to.be.a('function')
    expect(index.createSender).to.be.a('function')
  })
})
