import { settings as sharedSettings } from '@yidongw/pawx-schemas'
import { eq } from 'drizzle-orm'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import db from '@/db'
import { withDbError } from '@/utils/db'

const settings: any = sharedSettings

export async function getSetting(key: string, tx?: PostgresJsDatabase) {
  const setting = await withDbError(
    (db() || tx).select().from(settings).where(eq(settings.key, key))
  )
  return setting[0]?.value
}

export async function setSetting(key: string, value: string, tx?: PostgresJsDatabase) {
  await withDbError(
    (db() || tx).insert(settings).values({ key, value }).onConflictDoUpdate({
      target: settings.key,
      set: { value }
    })
  )
}
