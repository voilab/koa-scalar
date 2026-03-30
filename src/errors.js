class ParserError extends Error {
    constructor(message, code, data) {
        super(message)
        this.name = 'ParserError'
        this.code = code
        this.data = data
    }
}

class RouterError extends Error {
    constructor(message, code, data) {
        super(message)
        this.name = 'RouterError'
        this.code = code
        this.data = data
    }
}

class ValidatorError extends Error {
    constructor(message, code, data) {
        super(message)
        this.name = 'ValidatorError'
        this.code = code
        this.data = data
    }
}

module.exports = {
    ParserError,
    RouterError,
    ValidatorError
}
