import { describe, expect, it } from 'vitest'
import { FMSODataError, parseErrorResponse } from '../../src/errors.js'

const REQ = { url: 'https://fms.example.com/fmi/odata/v4/DB/x', method: 'GET' as const }

describe('FMSODataError', () => {
  it('captures status, code, odataError, and request', () => {
    const err = new FMSODataError('boom', {
      status: 500,
      code: '123',
      odataError: { foo: 1 },
      request: REQ,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('FMSODataError')
    expect(err.status).toBe(500)
    expect(err.code).toBe('123')
    expect(err.odataError).toEqual({ foo: 1 })
    expect(err.request).toEqual(REQ)
  })
})

describe('parseErrorResponse', () => {
  it('parses stock OData JSON envelope', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: '404', message: 'Not Found' } }),
      { status: 404, statusText: 'Not Found', headers: { 'content-type': 'application/json' } },
    )
    const err = await parseErrorResponse(res, REQ)
    expect(err.status).toBe(404)
    expect(err.code).toBe('404')
    expect(err.message).toBe('Not Found')
    expect(err.request).toEqual(REQ)
  })

  it('parses JSON envelope with nested message.value', async () => {
    const res = new Response(
      JSON.stringify({ error: { code: 'X', message: { value: 'deep' } } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
    const err = await parseErrorResponse(res, REQ)
    expect(err.code).toBe('X')
    expect(err.message).toBe('deep')
  })

  it("parses FileMaker's XML envelope", async () => {
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<m:error xmlns:m="http://docs.oasis-open.org/odata/ns/metadata">' +
      '<m:code>212</m:code>' +
      '<m:message xml:lang="en">(212): Invalid account/password</m:message>' +
      '</m:error>'
    const res = new Response(body, {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/xml' },
    })
    const err = await parseErrorResponse(res, REQ)
    expect(err.status).toBe(401)
    expect(err.code).toBe('212')
    expect(err.message).toBe('(212): Invalid account/password')
  })

  it('falls back to statusText when body is empty', async () => {
    const res = new Response('', { status: 500, statusText: 'Server Error' })
    const err = await parseErrorResponse(res, REQ)
    expect(err.status).toBe(500)
    expect(err.message).toBe('Server Error')
    expect(err.code).toBeUndefined()
  })

  it('falls back to "HTTP <status>" when statusText is empty', async () => {
    const res = new Response('', { status: 418, statusText: '' })
    const err = await parseErrorResponse(res, REQ)
    expect(err.message).toBe('HTTP 418')
  })

  it('detects JSON / XML from body shape even without content-type', async () => {
    const jsonRes = new Response(JSON.stringify({ error: { code: 'Z', message: 'zz' } }), {
      status: 400,
    })
    const err = await parseErrorResponse(jsonRes, REQ)
    expect(err.code).toBe('Z')
    expect(err.message).toBe('zz')

    const xmlRes = new Response(
      '<m:error xmlns:m="x"><m:code>99</m:code><m:message>bad</m:message></m:error>',
      { status: 400 },
    )
    const err2 = await parseErrorResponse(xmlRes, REQ)
    expect(err2.code).toBe('99')
    expect(err2.message).toBe('bad')
  })
})
