const fs = require('node:fs/promises')
const { join } = require('node:path')
const { mkdtemp, writeFile, readFile, mkdir, readdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const KoaTreeRouter = require('koa-tree-router')

const Router = require('../src/router.js')
const { RouterError } = require('../src/errors.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTmpDir() {
    return mkdtemp(join(tmpdir(), 'koa-scalar-router-test-'))
}

async function writeFileAt(baseDir, relativePath, content) {
    const fullPath = join(baseDir, relativePath)
    await mkdir(fullPath.split('/').slice(0, -1).join('/'), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
}

// A fully valid OpenAPI 3.1.1 base spec.
// @scalar/openapi-parser requires openapi + info + at least one real path.
const BASE_SPEC = `
openapi: 3.1.1
info:
  title: Test
  description: "Some description with var: %env(KOA_SCALAR_TEST_TITLE)% and default %env(KOA_SCALAR_TEST_DEFAULT:KOA_SCALAR_TEST_EMPTY)%"
  version: 1.0.0
`

const HELLO_PATH = `
/hello:
  get:
    summary: Hello
    responses:
      '200':
        description: ok
`

/**
 * Creates a minimal valid project:
 * - openapi/index.yaml     → base spec
 * - openapi/paths/hello.yaml → one GET /hello route (no security)
 * - controllers/v1/hello.js → implements get()
 */
async function scaffold(dir) {
    await writeFileAt(dir, 'openapi/index.yaml', BASE_SPEC)
    await writeFileAt(dir, 'openapi/paths/hello.yaml', HELLO_PATH)
    await writeFileAt(dir, 'controllers/v1/hello.js', `
module.exports = {
    get(ctx) { ctx.body = { hello: true }; ctx.status = 200 }
}
`)
}

/** Adds a Bearer security scheme and one secured route on top of scaffold(). */
async function scaffoldWithSecurity(dir) {
    await scaffold(dir)
    await writeFileAt(dir, 'openapi/components/securitySchemes/bearerAuth.yaml', `
bearerAuth:
  type: http
  scheme: bearer
`)
    await writeFileAt(dir, 'openapi/paths/secure.yaml', `
/secure:
  get:
    security:
      - bearerAuth: []
    responses:
      '200':
        description: ok
`)
    await writeFileAt(dir, 'controllers/security/bearerAuth.js', `
module.exports = (options, schema) => (ctx, next) => next()
`)
    await writeFileAt(dir, 'controllers/v1/secure.js', `
module.exports = { get(ctx) { ctx.body = { ok: true } } }
`)
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('Router — constructor', () => {
    test('throws RouterError when no options are provided', () => {
        expect(() => new Router()).toThrow(RouterError)
    })

    test('throws RouterError with code "configValidationError" for missing required options', () => {
        expect(() => new Router({})).toThrow(expect.objectContaining({ code: 'configValidationError' }))
    })

    test('throws RouterError when ctrlDir is an empty string', () => {
        expect(() => new Router({ ctrlDir: '', docDir: './d', version: '/v1' })).toThrow(RouterError)
    })

    test('throws RouterError when docDir is missing', () => {
        expect(() => new Router({ ctrlDir: './c', version: '/v1' })).toThrow(RouterError)
    })

    test('throws RouterError when version is missing', () => {
        expect(() => new Router({ ctrlDir: './c', docDir: './d' })).toThrow(RouterError)
    })

    test('creates a Router instance with valid minimal options', async () => {
        const dir = await createTmpDir()
        const router = new Router({ ctrlDir: dir, docDir: dir, version: '/v1' })
        expect(router).toBeDefined()
        expect(router.version).toBe('/v1')
    })

    test.each([
        ['parseInput',     true],
        ['validateInput',  true],
        ['validateOutput', false],
    ])('defaults %s to %s', async (key, expected) => {
        const dir = await createTmpDir()
        expect(new Router({ ctrlDir: dir, docDir: dir, version: '/v1' })[key]).toBe(expected)
    })

    test.each([
        ['parseInput',     false],
        ['validateInput',  false],
        ['validateOutput', true],
    ])('accepts %s:%s override', async (key, value) => {
        const dir = await createTmpDir()
        expect(new Router({ ctrlDir: dir, docDir: dir, version: '/v1', [key]: value })[key]).toBe(value)
    })

    test('reuses an existing KoaTreeRouter instance when passed as routerConfig', async () => {
        const dir = await createTmpDir()
        const ktr = new KoaTreeRouter()
        expect(new Router({ ctrlDir: dir, docDir: dir, version: '/v1', routerConfig: ktr }).router).toBe(ktr)
    })

    test('creates a new KoaTreeRouter when routerConfig is a plain object', async () => {
        const dir = await createTmpDir()
        expect(new Router({ ctrlDir: dir, docDir: dir, version: '/v1', routerConfig: {} }).router)
            .toBeInstanceOf(KoaTreeRouter)
    })
})

// ─── clean ────────────────────────────────────────────────────────────────────

describe('Router — clean()', () => {
    test('sets validator, router and parser to null', async () => {
        const dir = await createTmpDir()
        const router = new Router({ ctrlDir: dir, docDir: dir, version: '/v1' })
        router.clean()
        expect(router.validator).toBeNull()
        expect(router.router).toBeNull()
        expect(router.parser).toBeNull()
    })
})

// ─── routes ───────────────────────────────────────────────────────────────────

describe('Router — routes()', () => {
    test('returns a middleware function', async () => {
        const dir = await createTmpDir()
        expect(typeof new Router({ ctrlDir: dir, docDir: dir, version: '/v1' }).routes()).toBe('function')
    })
})

// ─── build — success cases ────────────────────────────────────────────────────

describe('Router — build() — success cases', () => {
    test('builds routes for a minimal project without throwing', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        }).build()).resolves.toBeUndefined()
    })

    test('builds routes with a security middleware', async () => {
        const dir = await createTmpDir()
        await scaffoldWithSecurity(dir)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        }).build()).resolves.toBeUndefined()
    })

    test.each([
        ['validateInput disabled',  { validateInput: false }],
        ['validateOutput enabled',  { validateOutput: true }],
        ['parseInput disabled',     { parseInput: false }],
    ])('builds successfully with %s', async (_, options) => {
        const dir = await createTmpDir()
        await scaffold(dir)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1',
            ...options
        }).build()).resolves.toBeUndefined()
    })

    test('builds routes for path parameters ({param} → :param in koa-tree-router)', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)
        await writeFileAt(dir, 'openapi/paths/items/_item_id/index.yaml', `
/items/{item_id}:
  get:
    parameters:
      - name: item_id
        in: path
        required: true
        schema:
          type: string
    responses:
      '200':
        description: ok
`)
        await writeFileAt(dir, 'controllers/v1/items/_item_id/index.js', `
module.exports = { get(ctx) { ctx.body = { id: ctx.params.item_id } } }
`)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        }).build()).resolves.toBeUndefined()
    })

    test('skips api explorer setup when apiExplorer.url is not provided', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        }).build()).resolves.toBeUndefined()
    })

    test('builds api explorer routes when apiExplorer.url is set', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)
        await expect(new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1',
            apiExplorer: { url: '/docs' }
        }).build()).resolves.toBeUndefined()
    })

    test('replaces env vars in the openapi JSON served by the api explorer', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)

        const before = await readdir(tmpdir())

        process.env.KOA_SCALAR_TEST_TITLE = 'MyApp'
        await new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1',
            apiExplorer: { url: '/docs', envWhitelist: ['KOA_SCALAR_TEST_TITLE'] }
        }).build()

        const after = await readdir(tmpdir())
        const newDirs = after.filter(f => !before.includes(f) && f.startsWith('node-koa-scalar-openapi'))
        expect(newDirs.length).toBeGreaterThan(0)

        const jsonFile = join(tmpdir(), newDirs[0]) + '.json'
        const content = await readFile(jsonFile, 'utf-8')

        expect(content).toContain('MyApp')
        expect(content).not.toContain('%env(KOA_SCALAR_TEST_TITLE)%')

        delete process.env.KOA_SCALAR_TEST_TITLE
    })

    test('replaces env vars with default in the openapi JSON served by the api explorer', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)

        const before = await readdir(tmpdir())

        process.env.KOA_SCALAR_TEST_DEFAULT = 'MyAppDefault'
        await new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1',
            apiExplorer: { url: '/docs', envWhitelist: ['KOA_SCALAR_TEST_DEFAULT'] }
        }).build()

        const after = await readdir(tmpdir())
        const newDirs = after.filter(f => !before.includes(f) && f.startsWith('node-koa-scalar-openapi'))
        expect(newDirs.length).toBeGreaterThan(0)

        const jsonFile = join(tmpdir(), newDirs[0]) + '.json'
        const content = await readFile(jsonFile, 'utf-8')

        expect(content).toContain('MyAppDefault')
        expect(content).not.toContain('%env(KOA_SCALAR_TEST_DEFAULT:KOA_SCALAR_TEST_EMPTY)%')

        delete process.env.KOA_SCALAR_TEST_DEFAULT
    })

    test('replaces no env vars in the openapi JSON served by the api explorer, because no whitelist', async () => {
        const dir = await createTmpDir()
        await scaffold(dir)

        const before = await readdir(tmpdir())

        process.env.KOA_SCALAR_TEST_TITLE = 'MyApp'
        await new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1',
            apiExplorer: { url: '/docs' }
        }).build()

        const after = await readdir(tmpdir())
        const newDirs = after.filter(f => !before.includes(f) && f.startsWith('node-koa-scalar-openapi'))
        expect(newDirs.length).toBeGreaterThan(0)

        const jsonFile = join(tmpdir(), newDirs[0]) + '.json'
        const content = await readFile(jsonFile, 'utf-8')

        expect(content).toContain('KOA_SCALAR_TEST_TITLE')
        expect(content).not.toContain('%env(KOA_SCALAR_TEST_TITLE)%')

        delete process.env.KOA_SCALAR_TEST_TITLE
    })
})

// ─── build — error cases ──────────────────────────────────────────────────────

describe('Router — build() — error cases', () => {
    test('throws RouterError with code "moduleLoadError" when the controller file is missing', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'openapi/index.yaml', BASE_SPEC)
        await writeFileAt(dir, 'openapi/paths/ghost.yaml', `
/ghost:
  get:
    summary: No controller
    responses:
      '200':
        description: ok
`)
        // intentionally no controllers/v1/ghost.js
        const router = new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        })
        await expect(router.build()).rejects.toThrow(RouterError)
        await expect(router.build()).rejects.toMatchObject({ code: 'moduleLoadError' })
    })

    test('throws RouterError with code "methodNotFound" when the HTTP method is not exported', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'openapi/index.yaml', BASE_SPEC)
        await writeFileAt(dir, 'openapi/paths/partial.yaml', `
/partial:
  post:
    requestBody:
      content:
        application/json:
          schema:
            type: object
    responses:
      '200':
        description: ok
`)
        await writeFileAt(dir, 'controllers/v1/partial.js', `
module.exports = { get(ctx) { ctx.body = {} } }  // only get, not post
`)
        const router = new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        })
        await expect(router.build()).rejects.toThrow(RouterError)
        await expect(router.build()).rejects.toMatchObject({ code: 'methodNotFound' })
    })

    test('throws RouterError with code "securityLoadError" when a security module file is missing', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'openapi/index.yaml', BASE_SPEC)
        await writeFileAt(dir, 'openapi/components/securitySchemes/apiKeyHeader.yaml', `
apiKeyHeader:
  type: apiKey
  in: header
  name: X-API-Key
`)
        await writeFileAt(dir, 'openapi/paths/hello.yaml', HELLO_PATH)
        await writeFileAt(dir, 'openapi/paths/guarded.yaml', `
/guarded:
  get:
    security:
      - apiKeyHeader: []
    responses:
      '200':
        description: ok
`)
        await writeFileAt(dir, 'controllers/v1/hello.js', `module.exports = { get(ctx) { ctx.body = {} } }`)
        await writeFileAt(dir, 'controllers/v1/guarded.js', `module.exports = { get(ctx) { ctx.body = {} } }`)
        // intentionally no controllers/security/apiKeyHeader.js
        const router = new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        })
        await expect(router.build()).rejects.toThrow(RouterError)
        await expect(router.build()).rejects.toMatchObject({ code: 'securityLoadError' })
    })

    test('throws RouterError with code "securityNotFound" when a route references an undeclared security scheme', async () => {
        const dir = await createTmpDir()
        await writeFileAt(dir, 'openapi/index.yaml', BASE_SPEC)
        await writeFileAt(dir, 'openapi/components/securitySchemes/bearerAuth.yaml', `
bearerAuth:
  type: http
  scheme: bearer
`)
        await writeFileAt(dir, 'openapi/paths/hello.yaml', HELLO_PATH)
        await writeFileAt(dir, 'openapi/paths/broken.yaml', `
/broken:
  get:
    security:
      - undeclaredScheme: []
    responses:
      '200':
        description: ok
`)
        await writeFileAt(dir, 'controllers/security/bearerAuth.js', `module.exports = () => (ctx, next) => next()`)
        await writeFileAt(dir, 'controllers/v1/hello.js', `module.exports = { get(ctx) { ctx.body = {} } }`)
        await writeFileAt(dir, 'controllers/v1/broken.js', `module.exports = { get(ctx) { ctx.body = {} } }`)
        const router = new Router({
            ctrlDir: join(dir, 'controllers'),
            docDir: join(dir, 'openapi'),
            version: '/v1'
        })
        await expect(router.build()).rejects.toThrow(RouterError)
        await expect(router.build()).rejects.toMatchObject({ code: 'securityNotFound' })
    })
})
