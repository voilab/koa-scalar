const { ParserError, RouterError, ValidatorError } = require('../src/errors.js')

// ─── ParserError ──────────────────────────────────────────────────────────────

describe('ParserError', () => {
    test('is an instance of Error', () => {
        const err = new ParserError('msg', 'code')
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(ParserError)
    })

    test('sets message, name, code and data', () => {
        const data = { file: 'test.yaml' }
        const err = new ParserError('parse failed', 'fileParseError', data)
        expect(err.message).toBe('parse failed')
        expect(err.name).toBe('ParserError')
        expect(err.code).toBe('fileParseError')
        expect(err.data).toBe(data)
    })

    test('data is undefined when not provided', () => {
        expect(new ParserError('msg', 'code').data).toBeUndefined()
    })

    test('has a stack trace', () => {
        expect(new ParserError('msg', 'code').stack).toBeDefined()
    })

    test('is not an instance of RouterError or ValidatorError', () => {
        const err = new ParserError('msg', 'code')
        expect(err).not.toBeInstanceOf(RouterError)
        expect(err).not.toBeInstanceOf(ValidatorError)
    })
})

// ─── RouterError ──────────────────────────────────────────────────────────────

describe('RouterError', () => {
    test('is an instance of Error', () => {
        const err = new RouterError('msg', 'code')
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(RouterError)
    })

    test('sets message, name, code and data', () => {
        const data = { path: '/v1/users' }
        const err = new RouterError('route failed', 'moduleLoadError', data)
        expect(err.message).toBe('route failed')
        expect(err.name).toBe('RouterError')
        expect(err.code).toBe('moduleLoadError')
        expect(err.data).toBe(data)
    })

    test('data is undefined when not provided', () => {
        expect(new RouterError('msg', 'code').data).toBeUndefined()
    })

    test('is not an instance of ParserError or ValidatorError', () => {
        const err = new RouterError('msg', 'code')
        expect(err).not.toBeInstanceOf(ParserError)
        expect(err).not.toBeInstanceOf(ValidatorError)
    })
})

// ─── ValidatorError ───────────────────────────────────────────────────────────

describe('ValidatorError', () => {
    test('is an instance of Error', () => {
        const err = new ValidatorError('msg', 'code')
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(ValidatorError)
    })

    test('sets message, name, code and data', () => {
        const data = [{ message: 'required', field: 'name' }]
        const err = new ValidatorError('validation failed', 'parameterValidationError', data)
        expect(err.message).toBe('validation failed')
        expect(err.name).toBe('ValidatorError')
        expect(err.code).toBe('parameterValidationError')
        expect(err.data).toBe(data)
    })

    test('data is undefined when not provided', () => {
        expect(new ValidatorError('msg', 'code').data).toBeUndefined()
    })

    test('is not an instance of ParserError or RouterError', () => {
        const err = new ValidatorError('msg', 'code')
        expect(err).not.toBeInstanceOf(ParserError)
        expect(err).not.toBeInstanceOf(RouterError)
    })
})
