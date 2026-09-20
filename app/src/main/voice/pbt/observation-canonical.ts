import { createHash } from 'crypto'
import type { JsonValue, PropertyIdentity } from './observation-schema'

interface ConversionContext {
  active: WeakSet<object>
  seen: WeakSet<object>
}

const ERROR_PROTOTYPES = new Set([
  Error.prototype,
  EvalError.prototype,
  RangeError.prototype,
  ReferenceError.prototype,
  SyntaxError.prototype,
  TypeError.prototype,
  URIError.prototype
])

const VIEW_TYPES = new Map<object, string>([
  [Int8Array.prototype, 'Int8Array'],
  [Uint8Array.prototype, 'Uint8Array'],
  [Uint8ClampedArray.prototype, 'Uint8ClampedArray'],
  [Int16Array.prototype, 'Int16Array'],
  [Uint16Array.prototype, 'Uint16Array'],
  [Int32Array.prototype, 'Int32Array'],
  [Uint32Array.prototype, 'Uint32Array'],
  [Float32Array.prototype, 'Float32Array'],
  [Float64Array.prototype, 'Float64Array'],
  [BigInt64Array.prototype, 'BigInt64Array'],
  [BigUint64Array.prototype, 'BigUint64Array']
])

function requirePrototype(input: object, prototype: object, type: string): void {
  if (Object.getPrototypeOf(input) !== prototype)
    throw new TypeError(`PBT observation values cannot capture custom ${type} prototypes`)
}

function requireGlobalSymbolKey(value: symbol): string {
  const globalKey = Symbol.keyFor(value)
  if (globalKey === undefined)
    throw new TypeError('PBT observation values cannot capture local symbols')
  return globalKey
}

function encodePropertyKey(key: PropertyKey): JsonValue {
  if (typeof key !== 'symbol') return { $type: 'string-key', value: key }
  return { $type: 'symbol-key', globalKey: requireGlobalSymbolKey(key) }
}

function formatPropertyKey(key: PropertyKey): string {
  if (typeof key !== 'symbol') return `string:${key}`
  return `symbol:${requireGlobalSymbolKey(key)}`
}

function comparePropertyKeys(
  left: { sortKey: string; ordinal: number },
  right: { sortKey: string; ordinal: number }
): number {
  if (left.sortKey < right.sortKey) return -1
  if (left.sortKey > right.sortKey) return 1
  return left.ordinal - right.ordinal
}

function encodeProperties(
  input: object,
  context: ConversionContext,
  omit: (key: PropertyKey) => boolean = () => false
): JsonValue[] {
  return Reflect.ownKeys(input)
    .map((key, ordinal) => ({ key, ordinal, sortKey: formatPropertyKey(key) }))
    .filter(({ key }) => !omit(key))
    .sort(comparePropertyKeys)
    .map(({ key }) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor) throw new TypeError('PBT observation property descriptor disappeared')
      const common = {
        key: encodePropertyKey(key),
        enumerable: descriptor.enumerable ?? false,
        configurable: descriptor.configurable ?? false
      }
      if ('value' in descriptor) {
        return {
          ...common,
          kind: 'data',
          writable: descriptor.writable ?? false,
          value: convertTaggedValue(descriptor.value, context)
        }
      }
      throw new TypeError('PBT observation values cannot capture functions')
    })
}

function withProperties(base: Record<string, JsonValue>, properties: JsonValue[]): JsonValue {
  return properties.length === 0 ? base : { ...base, properties }
}

function isArrayIndex(key: PropertyKey): key is string {
  return typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)
}

function hasStandardDenseIndexes(input: unknown[]): boolean {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length')
  if (!lengthDescriptor?.writable) return false
  const indexKeys = Reflect.ownKeys(input).filter(isArrayIndex)
  if (indexKeys.length !== input.length) return false
  return indexKeys.every((key) => {
    const index = Number(key)
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    return (
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < input.length &&
      Boolean(
        descriptor &&
        'value' in descriptor &&
        descriptor.enumerable &&
        descriptor.configurable &&
        descriptor.writable
      )
    )
  })
}

function convertArray(input: unknown[], context: ConversionContext): JsonValue {
  if (!hasStandardDenseIndexes(input)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length')
    return {
      $type: 'Array',
      length: input.length,
      lengthWritable: lengthDescriptor?.writable ?? false,
      properties: encodeProperties(input, context, (key) => key === 'length')
    }
  }
  const values = input.map((value) => convertTaggedValue(value, context))
  const properties = encodeProperties(
    input,
    context,
    (key) => key === 'length' || isArrayIndex(key)
  )
  return properties.length === 0 ? values : { $type: 'Array', values, properties }
}

function convertObject(input: object, context: ConversionContext): JsonValue {
  if (context.active.has(input)) throw new TypeError('PBT observation values cannot contain cycles')
  if (context.seen.has(input))
    throw new TypeError('PBT observation values cannot contain shared references')
  context.seen.add(input)
  context.active.add(input)

  try {
    if (input instanceof Error) {
      if (!ERROR_PROTOTYPES.has(Object.getPrototypeOf(input)))
        throw new TypeError('PBT observation values cannot capture custom Error prototypes')
      return withProperties(
        {
          $type: 'Error',
          name: input.name,
          message: input.message,
          stack: input.stack ?? null
        },
        encodeProperties(input, context, (key) => key === 'stack' || key === 'message')
      )
    }
    if (input instanceof Date) {
      requirePrototype(input, Date.prototype, 'Date')
      return withProperties(
        { $type: 'Date', value: input.toISOString() },
        encodeProperties(input, context)
      )
    }
    if (input instanceof RegExp) {
      requirePrototype(input, RegExp.prototype, 'RegExp')
      return withProperties(
        { $type: 'RegExp', source: input.source, flags: input.flags, lastIndex: input.lastIndex },
        encodeProperties(input, context, (key) => key === 'lastIndex')
      )
    }
    if (input instanceof URL)
      throw new TypeError('PBT observation values cannot capture URL identity')
    if (input instanceof Map) {
      requirePrototype(input, Map.prototype, 'Map')
      return withProperties(
        {
          $type: 'Map',
          entries: [...input].map(([key, value]) => [
            convertTaggedValue(key, context),
            convertTaggedValue(value, context)
          ])
        },
        encodeProperties(input, context)
      )
    }
    if (input instanceof Set) {
      requirePrototype(input, Set.prototype, 'Set')
      return withProperties(
        { $type: 'Set', values: [...input].map((value) => convertTaggedValue(value, context)) },
        encodeProperties(input, context)
      )
    }
    if (input instanceof ArrayBuffer) {
      requirePrototype(input, ArrayBuffer.prototype, 'ArrayBuffer')
      return withProperties(
        { $type: 'ArrayBuffer', values: Array.from(new Uint8Array(input)) },
        encodeProperties(input, context)
      )
    }
    if (ArrayBuffer.isView(input)) {
      if (input instanceof DataView) {
        requirePrototype(input, DataView.prototype, 'DataView')
        return withProperties(
          {
            $type: 'DataView',
            values: Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
          },
          encodeProperties(input, context)
        )
      }
      const type = VIEW_TYPES.get(Object.getPrototypeOf(input))
      if (!type)
        throw new TypeError('PBT observation values cannot capture custom typed-array prototypes')
      return withProperties(
        {
          $type: type,
          values: Array.from(input as unknown as ArrayLike<number | bigint>, (value) =>
            convertTaggedValue(value, context)
          )
        },
        encodeProperties(input, context, isArrayIndex)
      )
    }
    if (Array.isArray(input)) {
      requirePrototype(input, Array.prototype, 'Array')
      return convertArray(input, context)
    }

    if (Object.getPrototypeOf(input) !== Object.prototype)
      throw new TypeError('PBT observation values cannot capture custom object prototypes')
    const ownKeys = Reflect.ownKeys(input)
    const simpleEntries = ownKeys.every((key) => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      return Boolean(
        descriptor &&
        'value' in descriptor &&
        descriptor.enumerable &&
        descriptor.configurable &&
        descriptor.writable
      )
    })
    if (simpleEntries) {
      const entries = (ownKeys as string[]).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('PBT observation property descriptor disappeared')
        return [key, convertTaggedValue(descriptor.value, context)]
      })
      return { $type: 'object', entries }
    }
    return {
      $type: 'object',
      name: null,
      properties: encodeProperties(input, context)
    }
  } finally {
    context.active.delete(input)
  }
}

function convertTaggedValue(input: unknown, context: ConversionContext): JsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (Object.is(input, -0)) return { $type: 'number', value: '-0' }
    if (Number.isFinite(input)) return input
    return { $type: 'number', value: String(input) }
  }
  if (typeof input === 'undefined') return { $type: 'undefined' }
  if (typeof input === 'bigint') return { $type: 'bigint', value: input.toString() }
  if (typeof input === 'symbol') {
    return { $type: 'symbol', globalKey: requireGlobalSymbolKey(input) }
  }
  if (typeof input === 'function')
    throw new TypeError('PBT observation values cannot capture functions')
  return convertObject(input, context)
}

export function toTaggedValue(input: unknown): JsonValue {
  return convertTaggedValue(input, { active: new WeakSet<object>(), seen: new WeakSet<object>() })
}

export function stringifyCanonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stringifyCanonical).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(value[key])}`)
    .join(',')}}`
}

export function hashCanonicalValue(input: unknown): string {
  return hashTaggedValue(toTaggedValue(input))
}

export function hashTaggedValue(value: JsonValue): string {
  return createHash('sha256').update(stringifyCanonical(value)).digest('hex')
}

export function createIncidentFingerprint(
  property: PropertyIdentity,
  counterexampleHash: string | null
): string {
  return hashCanonicalValue({
    propertyId: property.id,
    propertyVersion: property.version,
    invariant: property.invariant,
    counterexampleHash
  })
}
