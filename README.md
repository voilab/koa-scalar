# Koa Scalar

## Introduction

This is a router for Koa, which parses a local directory of Openapi@3 files (`yaml` or `json`) to automatically generate routes and parameters validation (input and output).

- [Dependencies](#dependencies)
- [Basic usage](#basic-usage)
- [Configurations](#configurations)
- [Controllers and folders structure](#controllers-folders-structure)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Contribution](#contribution)
- [License](#license)

## Dependencies

| Dependency | Dependency type | What for? |
| --- | --- | --- |
| **koa** | Peer | used as main web framework |
| **@scalar/openapi-parser** | Main | used for Openapi@3 validation, dereferencing, and web client documentation |
| **fastest-validator** | Main | used for parameters validation |
| **koa-tree-router** | Main | used for routing in Koa |
| **lodash** | Secondary | used for simplifing POJO manipulation (through `get`, `set` and `merge` exclusively) |
| **yaml** | Secondary | used to translate `*.yaml` files to POJO |
| **jest** | Test | Test suite |

## Basic usage

```js
// index.js
const Koa = require('koa')
const { Router } = require('voilab/koa-scalar')

const app = new Koa()

const router = new Router({
    docDir: './openapi',
    ctrlDir: './controllers',
    version: '/v1',
    apiExplorer: {
        url: '/docs'
    }
})

// builds routes based on Openapi specification
await router.build()

// add these routes to koa
app.use(router.routes())

app.listen(3000)
console.log('Documentation available on http://localhost:3000/docs')
console.log('API available on http://localhost:3000/v1')
```

## Configurations

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| docDir | `string` | `true` || Relative or absolute path to Openapi specification files |
| ctrlDir | `string` | `true` || Relative or absolute path to javascript controller files |
| version | `string` | `true` || API version name |
| parseInput | `boolean` | `false` | `true` | Parse arrays and objects input parameters when they are defined as strings |
| validateInput | `boolean` | `false` | `true` | Validate input against Openapi definition before controller is called |
| validateOutput | `boolean` | `false` | `false` | Validate Koa body content against Openapi response definition  |
| apiExplorer | `object` | `false` | empty object | Api explorer documentation configuration |
| apiExplorer.**url** | `string` | `false` | undefined | Path url to documentation |
| apiExplorer.**rootUrl** | `string` | `false` | undefined | Root path url used for loading api reference js script in some edge cases |
| apiExplorer.**envWhitelist** | `string[]` | `false` | `[]` | Names of env vars, allowed to be replaced in documentation |
| apiExplorer.**title** | `string` | `false` | undefined | Documentation title |
| apiExplorer.**lang** | `string` | `false` | undefined | HTML tag language code |
| apiExplorer.**head** | `string` | `false` | undefined | Custom &lt;head&gt; for documentation (CSS mainly) |
| apiExplorer.**config** | `object` | `false` | vendor defaults| Custom configuration for `Scalar` (documentation on [Github](https://github.com/scalar/scalar/blob/main/documentation/configuration.md)) |
| validatorConfig | `object` | `false` | vendor defaults | Custom configuration for (or instance of) `FastestValidator` (documentation on [Github](https://github.com/icebob/fastest-validator])) |
| routerConfig | `object` | `false` | vendor defaults | Custom configuration for (or instance of) `KoaTreeRouter` (documentation on [Github](https://github.com/steambap/koa-tree-router)) |

## Controllers folders structure

Consider Openapi documentation files such as this:

```
openapi
|-- index.yaml
|-- paths
    |-- users
        |-- search.yaml
```

Where the two files content are:

```yaml
# ./openapi/index.yaml
openapi: 3.1.1
info:
  title: Koa router test
security:
  - bearerAuth: []

# ./openapi/paths/users/search.yaml
/users/search:
  head:
    summary: Count users
    security:
      - bearerAuth: []
  get:
    summary: Search users
    security:
      - bearerAuth: []

```

And a router config like that:

```js
const router = new Router({
    docDir: './openapi',
    ctrlDir: './controllers',
    version: '/v1'
})
```

Controllers folder will look like this:

```
controllers
|-- security
|   |-- bearerAuth.js
|-- v1
    |-- users
        |-- search.js
```

The security module exports a function, itself returning a standard koa middleware:

```js
// ./controllers/security/bearerAuth.js
module.exports = (options, schema) => (ctx, next) => {
    console.log('bearer', options, schema, ctx.params)
    return next()
}
```

The defined route exports each HTTP lowercased method as a standard koa middleware:

```js
// ./controllers/v1/users/search.js
const { countUsers, listUsers } = require('some/user/service.js')

module.exports = {
    async head(ctx) {
        ctx.set('X-Total-Count', await countUsers())
        ctx.status = 204
    },
    async get(ctx) {
        ctx.body = await listUsers()
    }
}

```

## Limitations

### Fixed Scalar API reference version

The version shipped with this library is fixed to `api-reference@1.52.3`.

If you need an other version, you will need to fork this repository and replace the file `/src/docs/api-reference.js`, and maybe `/src/docs/index.html` if this is needed by the new javascript version.

You can use the script `npm run scalar-update` to automatically download the latest Scalar API reference.

### Validation limited to Content-Type application/json

Openapi@3 lets you configure different content types for requests and responses bodies (`application/json`, `application/xml` and so on).
Only `application/json` is taken into account regarding validation.

### Mix of static and dynamic routes

Due to how `KoaTreeRouter` works, it's not possible to configure static and dynamic routes on the same base path.

The example below **WILL NOT WORK**.

```yaml
/users/addresses-types:
  get:
    summary: List addresses types (private, professional, etc.)

/users/{user_id}:
  get:
    summary: Get user
    parameters:
      - name: user_id
        in: path
        required: true
        schema:
          type: string
          format: uuid
```

There is an open pull request: https://github.com/steambap/koa-tree-router/pull/29

## FAQ

### How to disable documentation?

Just leave `apiExplorer.url` empty. This way, no route will point to documentation.

### How can I define a nullable parameter?

In Openapi@3.1, the `type` property can be an array (see the validation [specification](https://datatracker.ietf.org/doc/html/draft-bhutton-json-schema-validation-01#name-type)). You can define [Scalar nullable schema property](https://swagger.io/specification/v3/#schema-object) to `true`, or add `null` in type array.

### Do Openapi files support environment variables?

Yes, this library has a (very) simple environment vars replacement, working with both YAML and JSON files. It uses `process.env.*` to find the value.

```sh
ENV_VAR="test"
ENV_DEFAULT="default value"
ENV_URL="https://www.somesite.net"
```

```yaml
info:
  title: "API docs for environment %env(ENV_VAR)%"
  description: "Some description: %env(ENV_DEFAULT:ENV_VAR)%, %env(ENV_DEFAULT:ENV_VAR_EMPTY)%"

servers:
  - url: %env(ENV_URL)%
```

Results in

```yaml
info:
  title: "API docs for environment test"
  description: "Some description: test, default value"

servers:
  - url: https://www.somesite.net
```

> You need to whitelist **all** your env vars if you want the replacement to work
```js
new Router({
  apiExplorer: {
    envWhitelist: ['ENV_VAR', 'ENV_DEFAULT', 'ENV_URL']
  }
})
```

### Advanced validation

This lib uses `FastestValidator` for validation. You can use Openapi schema parameter `format` to use any of the validators available.

You must use the [shorthand](https://github.com/icebob/fastest-validator?tab=readme-ov-file#shorthand-definitions) method to add options to the validator.

```yaml
name: email
schema:
  type: string
  format: email|normalize

name: age
schema:
  type: integer
  format: positive
```

### I don't want to convert value (for arrays, boolean, integer, string, etc)

By default all values are converted into the defined type, because this lib defaults `convert` option in FastestValidator to `true`.

If you don't want to convert values, you have to force conversion to false.

```yaml
name: ids
schema:
  type: array
  format: convert:false
  items:
    type: string

name: age
schema:
  type: integer
  format: positive|convert:false
```

## Contribution

Please send pull requests improving the usage and fixing bugs, improving documentation and providing better examples, or providing some tests, because these things are important.

Run tests with `npm run test`. It uses `jest` behind the scene.

## License

`koa-scalar` is available under the MIT license.
