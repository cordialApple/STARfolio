import {
  experienceToMarkdown,
  parseMarkdown,
  slugFor,
  type ParsedNote,
  type VaultExperience
} from './markdown'

export interface VaultFs {
  mkdir(dir: string): Promise<void>
  writeFile(path: string, data: string): Promise<void>
  readFile(path: string): Promise<string>
  readdir(dir: string): Promise<string[]>
  unlink(path: string): Promise<void>
  join(...parts: string[]): string
}

function writeNote(fs: VaultFs, dir: string, exp: VaultExperience): Promise<void> {
  return fs.writeFile(fs.join(dir, slugFor(exp)), experienceToMarkdown(exp))
}

export async function exportVault(
  fs: VaultFs,
  dir: string,
  experiences: VaultExperience[]
): Promise<{ written: number }> {
  await fs.mkdir(dir)
  for (const exp of experiences) await writeNote(fs, dir, exp)
  return { written: experiences.length }
}

export async function readVault(fs: VaultFs, dir: string): Promise<ParsedNote[]> {
  const names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.md'))
  const notes: ParsedNote[] = []
  for (const name of names) {
    notes.push(parseMarkdown(await fs.readFile(fs.join(dir, name))))
  }
  return notes
}

export async function mirrorNote(fs: VaultFs, dir: string, exp: VaultExperience): Promise<void> {
  await fs.mkdir(dir)
  await writeNote(fs, dir, exp)
}

export async function removeNote(
  fs: VaultFs,
  dir: string,
  exp: Pick<VaultExperience, 'id' | 'title'>
): Promise<void> {
  try {
    await fs.unlink(fs.join(dir, slugFor(exp)))
  } catch {
    // vault file may already be gone or renamed by the user; deletion is best-effort
  }
}
