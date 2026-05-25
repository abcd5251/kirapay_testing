import { Hono } from 'hono'
import * as twitterUserController from '../controllers/twitterUser'

export const route = new Hono()

route.get('/', twitterUserController.getTweetsAfterDate)
