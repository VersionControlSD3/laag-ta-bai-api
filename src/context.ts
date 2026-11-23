import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiService } from './lib/ai.js'
import type { CommuteService } from './lib/commute.js'
import type { AuthOptions } from './middleware/auth.js'
import type { DataStore } from './repositories/store.js'

export type PasswordRecoveryOptions = {
  createAuthClient: () => SupabaseClient
  redirectTo: string
}

export type AppContext = {
  store: DataStore
  ai: AiService
  commute: CommuteService
  auth: AuthOptions
  passwordRecovery?: PasswordRecoveryOptions
  corsOrigins: string[]
  dataSource: 'memory' | 'supabase'
}
