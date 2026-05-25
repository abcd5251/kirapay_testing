import { defineConfig } from 'vitest/config'
import path from 'node:path'
import tsconfig from "./tsconfig.json";
import { config } from "dotenv";

// Create an alias object from the paths in tsconfig.json
const alias = Object.fromEntries(
  // For Each Path in tsconfig.json
  Object.entries(tsconfig.compilerOptions.paths).map(([key, [value]]) => [
      // Remove the "/*" from the key and resolve the path
      key.replace("/*", ""),
      // Remove the "/*" from the value Resolve the relative path
      path.resolve(__dirname, value.replace("/*", ""))
  ])
);

export default defineConfig({
  test: {
    env: {
      ...config({ path: ".env.test" }).parsed,
    },
    fileParallelism: false,
  },
  resolve: {
    alias
  }
})
