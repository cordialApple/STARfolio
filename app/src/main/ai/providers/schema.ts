import { z } from 'zod'

const TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT'
}

type JsonNode = Record<string, unknown>

function convertSchemaNode(node: JsonNode): Record<string, unknown> {
  const anyOf = node.anyOf as JsonNode[] | undefined
  if (anyOf) {
    const nonNull = anyOf.filter((m) => m.type !== 'null')
    const nn = nonNull.length !== anyOf.length ? { nullable: true } : {}
    return nonNull.length === 1
      ? { ...convertSchemaNode(nonNull[0]), ...nn }
      : { anyOf: nonNull.map(convertSchemaNode), ...nn }
  }
  const out: Record<string, unknown> = {}
  const rawType = node.type
  let type: string | undefined
  let nullable = false
  if (Array.isArray(rawType)) {
    const nonNull = (rawType as string[]).filter((t) => t !== 'null')
    nullable = nonNull.length !== rawType.length
    type = nonNull[0]
  } else if (typeof rawType === 'string') {
    type = rawType
  }
  if (type && TYPE_MAP[type]) out.type = TYPE_MAP[type]
  if (nullable) out.nullable = true
  if (typeof node.description === 'string') out.description = node.description
  if (Array.isArray(node.enum)) out.enum = node.enum
  const props = node.properties as Record<string, JsonNode> | undefined
  if (props) out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, convertSchemaNode(v)]))
  if (Array.isArray(node.required)) out.required = node.required
  if (node.items) out.items = convertSchemaNode(node.items as JsonNode)
  return out
}

export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convertSchemaNode(z.toJSONSchema(schema) as JsonNode)
}

export function toOpenAiJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>
}
