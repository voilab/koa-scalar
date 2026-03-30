const { join, resolve } = require('node:path')
const { mkdtemp, writeFile, mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')

const Parser = require('../src/parser.js')
const { ParserError } = require('../src/errors.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTmpDir() {
    return mkdtemp(join(tmpdir(), 'koa-scalar-parser-test-'))
}

async function writeFileAt(baseDir, relativePath, content) {
    const fullPath = join(baseDir, relativePath)
    await mkdir(fullPath.split('/').slice(0, -1).join('/'), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// @scalar/openapi-parser requires openapi + info (title + version) + at least
// one real path with a response to consider a document valid.
const MINIMAL_SPEC = `
openapi: 3.1.1
info:
  title: Test API
  version: 1.0.0
paths:
  /ping:
    get:
      summary: Ping
      responses:
        '200':
          description: ok
`

const EXTRA_PATH = `
/hello:
  get:
    summary: Hello endpoint
    responses:
      '200':
        description: ok
`

// ─── constructor ──────────────────────────────────────────────────────────────

describe('Parser — constructor', () => {
    test('resolves docDir to an absolute path', async () => {
        const dir = await createTmpDir()
        expect(new Parser({ docDir: dir }).rootDir).toBe(resolve(dir))
    })
})

// ─── clean ────────────────────────────────────────────────────────────────────

describe('Parser — clean()', () => {
    test('sets rootDir to null', async () => {
        const dir = await createTmpDir()
        const p = new Parser({ docDir: dir })
        p.clean()
        expect(p.rootDir).toBeNull()
    })
})

// ─── parse — basic file reading ───────────────────────────────────────────────

describe('Parser — parse() — basic file reading', () => {
    test('parses a minimal valid YAML spec', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.openapi).toBe('3.1.1')
        expect(result.info.title).toBe('Test API')
    })

    test('parses a minimal valid JSON spec', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.json', JSON.stringify({
            openapi: '3.1.1',
            info: { title: 'JSON API', version: '1.0.0' },
            paths: { '/ping': { get: { summary: 'Ping', responses: { 200: { description: 'ok' } } } } }
        }))
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.openapi).toBe('3.1.1')
        expect(result.info.title).toBe('JSON API')
    })

    test('exposes defined paths after parsing', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.paths['/ping']).toBeDefined()
    })
})

// ─── parse — file merging ─────────────────────────────────────────────────────

describe('Parser — parse() — file merging', () => {
    test('merges an additional path file into the paths key', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        await writeFileAt(dir, 'paths/hello.yaml', EXTRA_PATH)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.paths['/hello']).toBeDefined()
        expect(result.paths['/hello'].get).toBeDefined()
    })

    test('merges multiple path files together', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        await writeFileAt(dir, 'paths/hello.yaml', EXTRA_PATH)
        await writeFileAt(dir, 'paths/world.yaml', `
/world:
  get:
    summary: World endpoint
    responses:
      '200':
        description: ok
`)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.paths['/hello']).toBeDefined()
        expect(result.paths['/world']).toBeDefined()
    })

    test('merges components schemas from a subdirectory', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        await writeFileAt(dir, 'components/schemas/User.yaml', `
User:
  type: object
  properties:
    id:
      type: integer
`)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.components?.schemas?.User).toBeDefined()
    })

    test('merges security schemes from components/securitySchemes', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        await writeFileAt(dir, 'components/securitySchemes/bearerAuth.yaml', `
bearerAuth:
  type: http
  scheme: bearer
`)
        const result = await new Parser({ docDir: dir }).parse()
        expect(result.components?.securitySchemes?.bearerAuth).toBeDefined()
    })
})

// ─── parse — error handling ───────────────────────────────────────────────────

describe('Parser — parse() — error handling', () => {
    // The condition is !valid && errors.length, so only specs that produce
    // actual errors in the errors array will throw schemaNotValid.

    test('throws ParserError with code "schemaNotValid" for a structurally broken spec', async () => {
        const dir = await createTmpDir()
        // Assigning a string to "paths" forces a type error that populates errors[].
        await writeFileAt(dir, 'index.yaml', `
openapi: 3.1.1
info:
  title: Bad
  version: 1.0.0
paths: "this is not an object"
`)
        await expect(new Parser({ docDir: dir }).parse()).rejects.toThrow(ParserError)
        await expect(new Parser({ docDir: dir }).parse()).rejects.toMatchObject({ code: 'schemaNotValid' })
    })

    // @scalar/openapi-parser returns valid:false but errors:[] for unknown
    // security scheme references. With !valid && errors.length the parser now
    // lets these through — the router's dereference step handles them instead.
    test('does not throw for a spec with an undeclared security reference (valid:false, errors:[])', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', MINIMAL_SPEC)
        await writeFileAt(dir, 'paths/broken.yaml', `
/broken:
  get:
    security:
      - undeclaredScheme: []
    responses:
      '200':
        description: ok
`)
        await expect(new Parser({ docDir: dir }).parse()).resolves.toBeDefined()
    })

    test('throws ParserError with code "fileParseError" for malformed YAML', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.yaml', `: totally: broken:\n  - bad\n indent: here\n`)
        await expect(new Parser({ docDir: dir }).parse()).rejects.toThrow(ParserError)
        await expect(new Parser({ docDir: dir }).parse()).rejects.toMatchObject({ code: 'fileParseError' })
    })

    test('throws ParserError with code "fileParseError" for malformed JSON', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'index.json', '{ broken json }')
        await expect(new Parser({ docDir: dir }).parse()).rejects.toThrow(ParserError)
        await expect(new Parser({ docDir: dir }).parse()).rejects.toMatchObject({ code: 'fileParseError' })
    })
})

// ─── parseParameters — array handling ────────────────────────────────────────

describe('Parser — parseParameters() — array handling', () => {
    let p

    beforeEach(async () => { p = new Parser({ docDir: await createTmpDir() }) })

    function ctx(query = {}, params = {}, headers = {}, cookies = {}) {
        return { params, request: { query, headers, cookies } }
    }

    test('does nothing when pathSchema has no parameters key', () => {
        const c = ctx({ q: 'hello' })
        expect(() => p.parseParameters(c, {})).not.toThrow()
        expect(c.request.query.q).toBe('hello')
    })

    test('splits a comma-separated string into an array (form style)', () => {
        const c = ctx({ ids: '1,2,3' })
        p.parseParameters(c, { parameters: [{ name: 'ids', in: 'query', schema: { type: 'array' }, style: 'form' }] })
        expect(c.request.query.ids).toEqual(['1', '2', '3'])
    })

    test('splits a space-delimited string into an array (spaceDelimited style)', () => {
        const c = ctx({ tags: 'a b c' })
        p.parseParameters(c, { parameters: [{ name: 'tags', in: 'query', schema: { type: 'array' }, style: 'spaceDelimited' }] })
        expect(c.request.query.tags).toEqual(['a', 'b', 'c'])
    })

    test('splits a pipe-delimited string into an array (pipeDelimited style)', () => {
        const c = ctx({ tags: 'x|y|z' })
        p.parseParameters(c, { parameters: [{ name: 'tags', in: 'query', schema: { type: 'array' }, style: 'pipeDelimited' }] })
        expect(c.request.query.tags).toEqual(['x', 'y', 'z'])
    })

    test('does not re-split a value that is already an array', () => {
        const c = ctx({ ids: ['1', '2'] })
        p.parseParameters(c, { parameters: [{ name: 'ids', in: 'query', schema: { type: 'array' }, style: 'form' }] })
        expect(c.request.query.ids).toEqual(['1', '2'])
    })

    test('remaps bracket notation "ids[]" to "ids"', () => {
        const c = ctx({ 'ids[]': '1,2' })
        p.parseParameters(c, { parameters: [{ name: 'ids', in: 'query', schema: { type: 'array' }, style: 'form' }] })
        expect(c.request.query.ids).toEqual(['1', '2'])
        expect(c.request.query['ids[]']).toBeUndefined()
    })

    test('splits a comma-delimited header value into an array (simple style)', () => {
        const c = ctx({}, {}, { 'x-ids': '1,2,3' })
        p.parseParameters(c, { parameters: [{ name: 'x-ids', in: 'header', schema: { type: 'array' }, style: 'simple' }] })
        expect(c.request.headers['x-ids']).toEqual(['1', '2', '3'])
    })

    // The path separator map is {} with no $default key — splitting never
    // triggers for path params, they arrive pre-split by the router.
    test('does not attempt to split a path parameter (no separator defined)', () => {
        const c = ctx({}, { ids: '1,2' })
        p.parseParameters(c, { parameters: [{ name: 'ids', in: 'path', schema: { type: 'array' } }] })
        expect(c.params.ids).toEqual(['1,2'])
    })
})

// ─── parseParameters — object handling ───────────────────────────────────────

describe('Parser — parseParameters() — object handling', () => {
    let p

    beforeEach(async () => { p = new Parser({ docDir: await createTmpDir() }) })

    function ctx(query = {}) {
        return { params: {}, request: { query, headers: {}, cookies: {} } }
    }

    // The object parser splits on the form $default separator (',') and pairs
    // up consecutive tokens: "k1,v1,k2,v2" → { k1: v1, k2: v2 }.
    test('converts a comma-separated key-value string into an object (form style)', () => {
        const c = ctx({ filter: 'name,John,age,30' })
        p.parseParameters(c, { parameters: [{ name: 'filter', in: 'query', schema: { type: 'object' }, style: 'form' }] })
        expect(c.request.query.filter).toEqual({ name: 'John', age: '30' })
    })

    test('does not re-transform a value that is already an object', () => {
        const c = ctx({ filter: { name: 'John' } })
        p.parseParameters(c, { parameters: [{ name: 'filter', in: 'query', schema: { type: 'object' } }] })
        expect(c.request.query.filter).toEqual({ name: 'John' })
    })
})

// ─── parseParameters — application/json content ──────────────────────────────

describe('Parser — parseParameters() — application/json content', () => {
    let p

    beforeEach(async () => { p = new Parser({ docDir: await createTmpDir() }) })

    function ctx(query = {}) {
        return { params: {}, request: { query, headers: {}, cookies: {} } }
    }

    const jsonParam = {
        name: 'data',
        in: 'query',
        content: { 'application/json': { schema: { type: 'object' } } }
    }

    test('parses a JSON string into an object', () => {
        const c = ctx({ data: '{"a":1}' })
        p.parseParameters(c, { parameters: [jsonParam] })
        expect(c.request.query.data).toEqual({ a: 1 })
    })

    test('does not re-parse a value that is already an object', () => {
        const c = ctx({ data: { a: 1 } })
        p.parseParameters(c, { parameters: [jsonParam] })
        expect(c.request.query.data).toEqual({ a: 1 })
    })

    test('throws ParserError with code "parameterUnserializable" for malformed JSON', () => {
        const c = ctx({ data: '{not valid json}' })
        expect(() => p.parseParameters(c, { parameters: [jsonParam] })).toThrow(ParserError)
        expect(() => p.parseParameters(c, { parameters: [jsonParam] })).toThrow(
            expect.objectContaining({ code: 'parameterUnserializable' })
        )
    })
})

// ─── parseParameters — edge cases ────────────────────────────────────────────

describe('Parser — parseParameters() — edge cases', () => {
    let p

    beforeEach(async () => { p = new Parser({ docDir: await createTmpDir() }) })

    test('skips processing silently when the parameter value is absent', () => {
        const c = { params: {}, request: { query: {}, headers: {}, cookies: {} } }
        expect(() => p.parseParameters(c, { parameters: [{ name: 'missing', in: 'query', schema: { type: 'array' } }] })).not.toThrow()
    })

    test('reads and parses cookie array parameters (form style)', () => {
        const c = { params: {}, request: { query: {}, headers: {}, cookies: { ids: '1,2' } } }
        p.parseParameters(c, { parameters: [{ name: 'ids', in: 'cookie', schema: { type: 'array' }, style: 'form' }] })
        expect(c.request.cookies.ids).toEqual(['1', '2'])
    })

    test('throws ParserError with code "koaContextNotFound" for an unknown parameter source', () => {
        const c = { params: {}, request: { query: { x: '1' }, headers: {}, cookies: {} } }
        const params = [{ name: 'x', in: 'unknown_source', schema: { type: 'string' } }]
        expect(() => p.parseParameters(c, { parameters: params })).toThrow(ParserError)
        expect(() => p.parseParameters(c, { parameters: params })).toThrow(
            expect.objectContaining({ code: 'koaContextNotFound' })
        )
    })
})
