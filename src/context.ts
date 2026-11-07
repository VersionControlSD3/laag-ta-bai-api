import type { AiService } from './lib/ai.js'
import type { CommuteService } from './lib/commute.js'
import type { AuthOptions } from './middleware/auth.js'
import type { DataStore } from './repositories/store.js'

export type AppContext = {
  store: DataStore
  ai: AiService
  commute: CommuteService
  auth: AuthOptions
  corsOrigins: string[]
  dataSource: 'memory' | 'supabase'
}
