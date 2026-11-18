import express from 'express'
import { createApp, createContext } from './createApp.js'
import { loadEnv } from './config/env.js'

const env = loadEnv()
const ctx = createContext(env)
const app = createApp(ctx, express())

app.listen(env.PORT, () => {
  console.log(`laag-ta-bai-api listening on http://localhost:${env.PORT}`)
  console.log(`  data source: ${ctx.dataSource}   ai: ${ctx.ai.mode}   dev auth: ${env.devAuthEnabled}`)
})
