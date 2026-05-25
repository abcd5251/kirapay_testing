import type { Context } from 'hono'

export const extractApiKey = (
  c: Context,
  headerName: string = 'X-API-Key',
  queryParamName: string = 'apiKey'
): string | undefined => {
  return c.req.header(headerName) || c.req.query(queryParamName)
}
