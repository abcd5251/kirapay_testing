import { authorisation as sharedAuthorisations, user as sharedUsers } from '@yidongw/pawx-schemas'
import { eq, and, sql } from 'drizzle-orm'
import { asc, desc } from 'drizzle-orm'
import httpStatus from 'http-status'
import { User, type UserTable } from '../models/user.model'
import { ApiError } from '../utils/ApiError'
import { type CreateUser, type UpdateUser } from '../validations/user.validation'
import db from '@/db'

const authorisations: any = sharedAuthorisations
const users: any = sharedUsers

interface getUsersFilter {
  email: string | undefined
}

interface getUsersOptions {
  sortBy: string
  limit: number
  page: number
}

export const createUser = async (userBody: CreateUser): Promise<User> => {
  try {
    const [result] = await db().insert(users).values(userBody).returning()
    const user = await getUserById(result.id)
    return user!
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, 'User already exists')
  }
}

export const queryUsers = async (
  filter: getUsersFilter,
  options: getUsersOptions
): Promise<User[]> => {
  const [sortField, direction] = options.sortBy.split(':') as [keyof UserTable, 'asc' | 'desc']
  let query
  query = db()
    .select()
    .from(users)
    .orderBy(direction === 'asc' ? asc(sql.identifier(sortField)) : desc(sql.identifier(sortField)))
    .limit(options.limit)
    .offset(options.limit * options.page)

  if (filter.email) {
    query = query.where(eq(users.email, filter.email))
  }

  const result = await query
  return result.map((user) => new User(user as UserTable))
}

export const getUserById = async (id: string): Promise<User | undefined> => {
  const [user] = await db().select().from(users).where(eq(users.id, id))
  return user ? new User(user as UserTable) : undefined
}

export const getUserByEmail = async (email: string): Promise<User | undefined> => {
  const [user] = await db().select().from(users).where(eq(users.email, email))
  return user ? new User(user as UserTable) : undefined
}

export const getUserByProviderIdType = async (id: string, type: any): Promise<User | undefined> => {
  const [user] = (await db()
    .select()
    .from(users)
    .innerJoin(authorisations, eq(authorisations.user_id, users.id))
    .where(
      and(eq(authorisations.provider_user_id, id), eq(authorisations.provider_type, type))
    )) as Array<{
    user: UserTable
  }>
  return user ? new User(user.user) : undefined
}

export const updateUserById = async (
  userId: string,
  updateBody: Partial<UpdateUser>
): Promise<User> => {
  try {
    const [updatedUser] = await db()
      .update(users)
      .set(updateBody)
      .where(eq(users.id, userId))
      .returning()

    if (!updatedUser) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
    }

    return new User(updatedUser)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(httpStatus.BAD_REQUEST, 'User already exists')
  }
}

export const deleteUserById = async (userId: string): Promise<void> => {
  const result = await db().delete(users).where(eq(users.id, userId)).returning()

  if (result.length < 1) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
}

export const getAuthorisations = async (userId: string) => {
  const auths = await db()
    .select()
    .from(users)
    .leftJoin(authorisations, eq(authorisations.user_id, users.id))
    .where(eq(users.id, userId))

  const typedAuths = auths as Array<{
    user: UserTable
    authorisation: {
      provider_type: string | null
    } | null
  }>

  if (!typedAuths) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate')
  }
  const response = {
    local: typedAuths[0].user.password !== null ? true : false
  }
  for (const auth of typedAuths) {
    if (auth.authorisation === null || auth.authorisation.provider_type === null) {
      continue
    }
    ;(response as any)[auth.authorisation.provider_type as any] = true
  }
  return response
}
