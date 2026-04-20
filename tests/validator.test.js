const FastestValidator = require('fastest-validator')
const Validator = require('../src/validator.js')
const { ValidatorError } = require('../src/errors.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParam(overrides = {}) {
    return {
        name: 'field',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        ...overrides
    }
}

function makeKoaCtx(overrides = {}) {
    return {
        params: {},
        request: {
            query: {},
            headers: {},
            cookies: {},
            body: undefined,
            ...(overrides.request || {})
        },
        headers: {},
        body: undefined,
        status: 200,
        ...overrides
    }
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('Validator — constructor', () => {
    test('creates a FastestValidator instance by default', () => {
        expect(new Validator().validator).toBeInstanceOf(FastestValidator)
    })

    test('accepts a plain config object and creates a FastestValidator from it', () => {
        expect(new Validator({ useNewCustomCheckerFunction: true }).validator).toBeInstanceOf(FastestValidator)
    })

    test('reuses an existing FastestValidator instance directly', () => {
        const fv = new FastestValidator()
        expect(new Validator(fv).validator).toBe(fv)
    })
})

// ─── clean ────────────────────────────────────────────────────────────────────

describe('Validator — clean()', () => {
    test('sets the internal validator to null', () => {
        const v = new Validator()
        v.clean()
        expect(v.validator).toBeNull()
    })
})

// ─── matchSchema — primitive types ───────────────────────────────────────────

describe('Validator — matchSchema() — primitive types', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('maps "string" to FV string type', () => {
        expect(v.matchSchema({ type: 'string' }).type).toBe('string')
    })

    test('maps "integer" to FV number type with integer:true', () => {
        const r = v.matchSchema({ type: 'integer' })
        expect(r.type).toBe('number')
        expect(r.integer).toBe(true)
    })

    test('maps "number" to FV number type with integer:false', () => {
        const r = v.matchSchema({ type: 'number' })
        expect(r.type).toBe('number')
        expect(r.integer).toBe(false)
    })

    test('maps "boolean" to FV boolean type', () => {
        expect(v.matchSchema({ type: 'boolean' }).type).toBe('boolean')
    })

    test('maps "array" to FV array type and recurses into items', () => {
        const r = v.matchSchema({ type: 'array', items: { type: 'string' } })
        expect(r.type).toBe('array')
        expect(r.items.type).toBe('string')
    })

    test('maps "object" to FV object type with nested properties', () => {
        const r = v.matchSchema({
            type: 'object',
            required: ['name'],
            properties: {
                name: { type: 'string' },
                age: { type: 'integer' }
            }
        })
        expect(r.type).toBe('object')
        expect(r.properties.name.type).toBe('string')
        expect(r.properties.age.type).toBe('number')
    })

    test('maps empty string type to FV "any"', () => {
        expect(v.matchSchema({ type: '' }).type).toBe('any')
    })

    test('maps missing type to FV "any"', () => {
        expect(v.matchSchema({}).type).toBe('any')
    })

    // null is filtered out of notNullTypes, leaving an empty propsDef array,
    // so matchSchema returns undefined (propsDef.length === 0, not === 1).
    test('returns empty array for a schema whose only type is null', () => {
        expect(v.matchSchema({ type: null })).toEqual([])
    })

    test('throws ValidatorError for an unknown type', () => {
        expect(() => v.matchSchema({ type: 'binary' })).toThrow(ValidatorError)
        expect(() => v.matchSchema({ type: 'binary' })).toThrow(
            expect.objectContaining({ code: 'schemaTypeMismatch' })
        )
    })
})

// ─── matchSchema — required / optional ───────────────────────────────────────

describe('Validator — matchSchema() — required / optional', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('sets optional:false when config.required is true', () => {
        expect(v.matchSchema({ type: 'string' }, { required: true }).optional).toBe(false)
    })

    test('sets optional:true when config.required is false or absent', () => {
        expect(v.matchSchema({ type: 'string' }, { required: false }).optional).toBe(true)
        expect(v.matchSchema({ type: 'string' }).optional).toBe(true)
    })

    test('marks object properties as required when listed in schema.required', () => {
        const r = v.matchSchema({
            type: 'object',
            required: ['name'],
            properties: {
                name: { type: 'string' },
                bio: { type: 'string' }
            }
        })
        expect(r.properties.name.optional).toBe(false)
        expect(r.properties.bio.optional).toBe(true)
    })
})

// ─── matchSchema — nullable ───────────────────────────────────────────────────

describe('Validator — matchSchema() — nullable', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('sets nullable:true when schema.nullable is true', () => {
        expect(v.matchSchema({ type: 'string', nullable: true }).nullable).toBe(true)
    })

    // When type is ['string', null], null is stripped leaving one real type.
    // propsDef.length === 1, so a single object is returned (not an array),
    // with nullable:true because null was present in the original type array.
    test('returns a single object with nullable:true when type array contains null alongside a real type', () => {
        const r = v.matchSchema({ type: ['string', null] })
        expect(Array.isArray(r)).toBe(false)
        expect(r.type).toBe('string')
        expect(r.nullable).toBe(true)
    })

    test('sets nullable:false for a plain non-nullable type', () => {
        expect(v.matchSchema({ type: 'string' }).nullable).toBe(false)
    })
})

// ─── matchSchema — readOnly / writeOnly ──────────────────────────────────────

describe('Validator — matchSchema() — readOnly / writeOnly', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('returns forbidden for a readOnly field in write mode', () => {
        const r = v.matchSchema({ type: 'string', readOnly: true }, { mode: 'write' })
        expect(r.type).toBe('forbidden')
        expect(r.remove).toBe(true)
    })

    test('returns forbidden for a writeOnly field in read mode', () => {
        expect(v.matchSchema({ type: 'string', writeOnly: true }, { mode: 'read' }).type).toBe('forbidden')
    })

    test('does not forbid a readOnly field in read mode', () => {
        expect(v.matchSchema({ type: 'string', readOnly: true }, { mode: 'read' }).type).toBe('string')
    })

    test('does not forbid a writeOnly field in write mode', () => {
        expect(v.matchSchema({ type: 'string', writeOnly: true }, { mode: 'write' }).type).toBe('string')
    })
})

// ─── matchSchema — string format mapping ─────────────────────────────────────

describe('Validator — matchSchema() — string format mapping', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test.each([
        ['email',     'email'],
        ['uuid',      'uuid'],
        ['date',      'date'],
        ['date-time', 'date'],
        ['datetime',  'date'],
        ['uri',       'url'],
        ['url',       'url'],
        ['luhn',      'luhn'],
        ['mac',       'mac'],
    ])('maps format "%s" to FV type "%s"', (format, expected) => {
        expect(v.matchSchema({ type: 'string', format }).type).toBe(expected)
    })

    test('falls back to FV "string" type for unknown formats', () => {
        expect(v.matchSchema({ type: 'string', format: 'custom-format' }).type).toBe('string')
    })

    test('uses FV "enum" type when schema has an enum array', () => {
        const r = v.matchSchema({ type: 'string', enum: ['a', 'b'] })
        expect(r.type).toBe('enum')
        expect(r.values).toEqual(['a', 'b'])
    })

    test('filters null out of enum values', () => {
        expect(v.matchSchema({ type: 'string', enum: ['a', null, 'b'] }).values).toEqual(['a', 'b'])
    })
})

// ─── matchSchema — format pipe options ───────────────────────────────────────

describe('Validator — matchSchema() — format pipe options', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('parses "email|normalize" into type:email with normalize:true', () => {
        const r = v.matchSchema({ type: 'string', format: 'email|normalize' })
        expect(r.type).toBe('email')
        expect(r.normalize).toBe(true)
    })

    test('parses "positive" format option on number', () => {
        expect(v.matchSchema({ type: 'number', format: 'positive' }).positive).toBe(true)
    })

    test('parses "negative" format option on number', () => {
        expect(v.matchSchema({ type: 'number', format: 'negative' }).negative).toBe(true)
    })

    test('parses "convert:false" to boolean false', () => {
        expect(v.matchSchema({ type: 'array', items: { type: 'string' }, format: 'convert:false' }).convert).toBe(false)
    })

    test('ignores format options not applicable to the type', () => {
        expect(v.matchSchema({ type: 'string', format: 'positive' }).positive).toBeUndefined()
    })
})

// ─── matchSchema — constraints ────────────────────────────────────────────────

describe('Validator — matchSchema() — constraints', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('maps minLength / maxLength to min / max for strings', () => {
        const r = v.matchSchema({ type: 'string', minLength: 2, maxLength: 50 })
        expect(r.min).toBe(2)
        expect(r.max).toBe(50)
    })

    test('maps minimum / maximum to min / max for numbers', () => {
        const r = v.matchSchema({ type: 'number', minimum: 0, maximum: 100 })
        expect(r.min).toBe(0)
        expect(r.max).toBe(100)
    })

    test('maps minItems / maxItems to min / max for arrays', () => {
        const r = v.matchSchema({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 })
        expect(r.min).toBe(1)
        expect(r.max).toBe(10)
    })

    test('maps uniqueItems to unique for arrays', () => {
        expect(v.matchSchema({ type: 'array', items: { type: 'string' }, uniqueItems: true }).unique).toBe(true)
    })

    test('maps pattern to pattern for strings', () => {
        expect(v.matchSchema({ type: 'string', pattern: '^[a-z]+$' }).pattern).toBe('^[a-z]+$')
    })

    test('maps minProperties / maxProperties to minProps / maxProps for objects', () => {
        const r = v.matchSchema({ type: 'object', minProperties: 1, maxProperties: 5, properties: {} })
        expect(r.minProps).toBe(1)
        expect(r.maxProps).toBe(5)
    })

    test('preserves the schema default value', () => {
        expect(v.matchSchema({ type: 'integer', default: 10 }).default).toBe(10)
    })
})

// ─── matchSchema — oneOf / anyOf ──────────────────────────────────────────────

describe('Validator — matchSchema() — oneOf / anyOf', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('returns an array of schemas for oneOf', () => {
        const r = v.matchSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] })
        expect(Array.isArray(r)).toBe(true)
        expect(r).toHaveLength(2)
        expect(r[0].type).toBe('string')
        expect(r[1].type).toBe('number')
    })

    test('returns an array of schemas for anyOf', () => {
        const r = v.matchSchema({ anyOf: [{ type: 'boolean' }, { type: 'string' }] })
        expect(Array.isArray(r)).toBe(true)
        expect(r).toHaveLength(2)
    })

    test('returns a single object (not an array) for a plain schema', () => {
        expect(Array.isArray(v.matchSchema({ type: 'string' }))).toBe(false)
    })
})

// ─── getInputValidatorSchema ──────────────────────────────────────────────────

describe('Validator — getInputValidatorSchema()', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('returns a compiled function when no parameters are defined', () => {
        expect(typeof v.getInputValidatorSchema({ parameters: [] })).toBe('function')
    })

    test.each([
        ['query',  { name: 'q',         in: 'query',  schema: { type: 'string' } }],
        ['path',   { name: 'id',        in: 'path',   required: true, schema: { type: 'string', format: 'uuid' } }],
        ['header', { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } }],
    ])('compiles a schema for a %s parameter', (_, param) => {
        expect(typeof v.getInputValidatorSchema({ parameters: [makeParam(param)] })).toBe('function')
    })

    test('compiles a schema for a request body', () => {
        expect(typeof v.getInputValidatorSchema({
            parameters: [],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: { name: { type: 'string' } } }
                    }
                }
            }
        })).toBe('function')
    })

    test('ignores parameters that have neither schema nor content', () => {
        expect(() => v.getInputValidatorSchema({ parameters: [{ name: 'x', in: 'query' }] })).not.toThrow()
    })

    test('uses content["application/json"].schema when parameter has content instead of schema', () => {
        expect(typeof v.getInputValidatorSchema({
            parameters: [{
                name: 'filter',
                in: 'query',
                content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'string' } } } } }
            }]
        })).toBe('function')
    })
})

// ─── validateInput ────────────────────────────────────────────────────────────

describe('Validator — validateInput()', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('resolves when all required parameters are present and valid', async () => {
        const schema = v.getInputValidatorSchema({
            parameters: [makeParam({ name: 'q', in: 'query', required: true, schema: { type: 'string' } })]
        })
        const ctx = makeKoaCtx({ request: { query: { q: 'hello' }, headers: {}, cookies: {}, body: undefined } })
        await expect(v.validateInput(ctx, schema)).resolves.toBeUndefined()
    })

    test('throws ValidatorError when a required parameter is missing', async () => {
        const schema = v.getInputValidatorSchema({
            parameters: [makeParam({ name: 'q', in: 'query', required: true, schema: { type: 'string' } })]
        })
        await expect(v.validateInput(makeKoaCtx(), schema)).rejects.toThrow(ValidatorError)
        await expect(v.validateInput(makeKoaCtx(), schema)).rejects.toMatchObject({ code: 'parameterValidationError' })
    })

    test('resolves when an optional parameter is absent', async () => {
        const schema = v.getInputValidatorSchema({
            parameters: [makeParam({ name: 'q', in: 'query', required: false, schema: { type: 'string' } })]
        })
        await expect(v.validateInput(makeKoaCtx(), schema)).resolves.toBeUndefined()
    })

    test('resolves when a valid body is provided', async () => {
        const schema = v.getInputValidatorSchema({
            parameters: [],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
                    }
                }
            }
        })
        const ctx = makeKoaCtx({ request: { query: {}, headers: {}, cookies: {}, body: { name: 'Alice' } } })
        await expect(v.validateInput(ctx, schema)).resolves.toBeUndefined()
    })

    test('throws ValidatorError when body is missing a required field', async () => {
        const schema = v.getInputValidatorSchema({
            parameters: [],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
                    }
                }
            }
        })
        const ctx = makeKoaCtx({ request: { query: {}, headers: {}, cookies: {}, body: {} } })
        await expect(v.validateInput(ctx, schema)).rejects.toThrow(ValidatorError)
    })
})

// ─── getOutputValidatorSchema ─────────────────────────────────────────────────

describe('Validator — getOutputValidatorSchema()', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('returns an empty object when no responses are defined', () => {
        expect(v.getOutputValidatorSchema({})).toEqual({})
    })

    test('returns an empty object when responses have no JSON body or headers', () => {
        expect(v.getOutputValidatorSchema({ responses: { 200: { description: 'ok' } } })).toEqual({})
    })

    test('compiles a schema for a response with a JSON body', () => {
        const result = v.getOutputValidatorSchema({
            responses: {
                200: {
                    content: {
                        'application/json': {
                            schema: { type: 'object', properties: { id: { type: 'integer' } } }
                        }
                    }
                }
            }
        })
        expect(typeof result['200']).toBe('function')
    })

    test('compiles a schema for a response with headers', () => {
        const result = v.getOutputValidatorSchema({
            responses: {
                204: { headers: { 'X-Total-Count': { required: true, schema: { type: 'integer' } } } }
            }
        })
        expect(typeof result['204']).toBe('function')
    })

    test('compiles schemas for multiple response codes', () => {
        const result = v.getOutputValidatorSchema({
            responses: {
                200: { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
                201: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } }
            }
        })
        expect(typeof result['200']).toBe('function')
        expect(typeof result['201']).toBe('function')
    })
})

// ─── validateOutput ───────────────────────────────────────────────────────────

describe('Validator — validateOutput()', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('resolves silently when no schema matches the response status', async () => {
        await expect(v.validateOutput(makeKoaCtx({ status: 200 }), {})).resolves.toBeUndefined()
    })

    test('uses the "default" schema when status is not explicitly listed', async () => {
        const schema = v.getOutputValidatorSchema({
            responses: {
                default: {
                    content: {
                        'application/json': {
                            schema: { type: 'object', properties: { id: { type: 'integer' } } }
                        }
                    }
                }
            }
        })
        await expect(v.validateOutput(makeKoaCtx({ status: 201, body: { id: 1 }, headers: {} }), schema)).resolves.toBeUndefined()
    })

    test('resolves when response body matches the schema', async () => {
        const schema = v.getOutputValidatorSchema({
            responses: {
                200: {
                    content: {
                        'application/json': {
                            schema: { type: 'object', properties: { id: { type: 'integer' } } }
                        }
                    }
                }
            }
        })
        await expect(v.validateOutput(makeKoaCtx({ status: 200, body: { id: 42 }, headers: {} }), schema)).resolves.toBeUndefined()
    })

    test('throws ValidatorError when response body does not match the schema', async () => {
        const schema = v.getOutputValidatorSchema({
            responses: {
                200: {
                    content: {
                        'application/json': {
                            schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }
                        }
                    }
                }
            }
        })
        const ctx = makeKoaCtx({ status: 200, body: { id: 'not-an-integer' }, headers: {} })
        await expect(v.validateOutput(ctx, schema)).rejects.toThrow(ValidatorError)
        await expect(v.validateOutput(ctx, schema)).rejects.toMatchObject({ code: 'parameterValidationError' })
    })
})

describe('Validator - error', () => {
    let v
    beforeEach(() => { v = new Validator() })

    test('throws ValidatorError with code "generalError" when matchSchema fails for a parameter', () => {
        // type "binary" is unknown and will cause matchSchema to throw,
        // which getInputValidatorSchema catches and re-throws as a generalError
        expect(() => v.getInputValidatorSchema({
            parameters: [makeParam({ name: 'bad', in: 'query', schema: { type: 'binary' } })]
        })).toThrow(ValidatorError)

        expect(() => v.getInputValidatorSchema({
            parameters: [makeParam({ name: 'bad', in: 'query', schema: { type: 'binary' } })]
        })).toThrow(expect.objectContaining({ code: 'generalError' }))
    })
})
