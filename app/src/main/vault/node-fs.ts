import { mkdir, writeFile, readFile, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import type { VaultFs } from './sync'

export const nodeVaultFs: VaultFs = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true })
  },
  writeFile: (path, data) => writeFile(path, data, 'utf8'),
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (dir) => readdir(dir),
  unlink: (path) => unlink(path),
  join
}
