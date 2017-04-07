'use strict'

const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const startsWith = require('lodash/fp/startsWith')
const debug = require('debug')('ilp:utils')
const DEFAULT_CONNECT_TIMEOUT = 10000

function safeConnect (plugin, timeoutOption) {
  const timeout = timeoutOption || DEFAULT_CONNECT_TIMEOUT
  return Promise.race([
    plugin.connect(),
    wait(timeout).then(() => {
      throw new Error('plugin timed out during connect (' + timeout + ' ms)')
    })
  ])
}

function xor (a, b) {
  return ((a || b) && (!a || !b))
}

function wait (duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

function retryPromise ({
  callback,
  minWait,
  maxWait,
  stopWaiting
}) {
  return callback().catch((e) => {
    debug('callback retry failed:', e)
    if ((new Date()) > (new Date(stopWaiting))) {
      debug('retry expiry of', stopWaiting, 'reached.')
      throw new Error('retry expiry of ' + stopWaiting + ' reached.')
    }

    debug('retrying callback in', minWait, 'ms...')
    return wait(Math.min(minWait, maxWait)).then(() => {
      debug('retrying callback')
      return retryPromise({
        callback,
        stopWaiting,
        maxWait,
        minWait: minWait * 2
      })
    })
  })
}

module.exports = {
  xor,
  wait,
  startsWith,
  safeConnect,
  retryPromise,
  omitUndefined,
  isUndefined
}
