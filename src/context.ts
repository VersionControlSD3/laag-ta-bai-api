import type { AiService } from './lib/ai.js'
import type { AuthOptions } from './middleware/auth.js'
import type { DataStore } from './repositories/store.js'

export type AppContext = {
  store: DataStore
  ai: AiService
  auth: AuthOptions
  corsOrigins: string[]
  dataSource: 'memory' | 'supabase'
}
