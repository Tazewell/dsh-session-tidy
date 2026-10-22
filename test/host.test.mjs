import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject } from '../index.js'

test('the host half registers one prefix route on activation', () => {
  const registered = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => registered.splice(registered.indexOf(route), 1)
      },
    },
    get() {
      return undefined
    },
    logger: { warn() {} },
  }
  apply(ctx)
  assert.deepEqual(inject, ['webServer'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/plugin/session-tidy')
  assert.equal(typeof registered[0].handler, 'function')
})

test('the activation effect returns the route disposer', () => {
  let disposer
  const ctx = {
    effect(fn) {
      disposer = fn()
    },
    webServer: { register: () => () => {} },
    get() {
      return undefined
    },
    logger: { warn() {} },
  }
  apply(ctx)
  assert.equal(typeof disposer, 'function')
})