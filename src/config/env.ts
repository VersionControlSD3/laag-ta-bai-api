import { z } from 'zod'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATA_SOURCE: z.preprocess(emptyToUndefined, z.enum(['memory', 'supabase']).optional()),
  SUPABASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  SUPABASE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().default('gemini-flash-latest')),
  ALLOW_DEV_AUTH: z
    .preprocess(emptyToUndefined, z.enum(['true', 'false']).default('true'))
    .transform((value) => value === 'true'),
})

export type Env = z.infer<typeof envSchema> & {
  dataSource: 'memory' | 'supabase'
  devAuthEnabled: boolean
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n  ${issues.join('\n  ')}`)
  }

  const env = parsed.data
  const hasSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY)
  const dataSource = env.DATA_SOURCE ?? (hasSupabase ? 'supabase' : 'memory')

  if (dataSource === 'supabase' && !hasSupabase) {
    throw new Error('DATA_SOURCE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.')
  }
  if (env.NODE_ENV === 'production' && dataSource === 'memory') {
    throw new Error('Production must use Supabase. Set SUPABASE_URL and SUPABASE_SECRET_KEY.')
  }

  return {
    ...env,
    dataSource,
    devAuthEnabled: env.ALLOW_DEV_AUTH && env.NODE_ENV !== 'production' && dataSource === 'memory',
  }
}
