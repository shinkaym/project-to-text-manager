import { access } from 'node:fs/promises'
import path from 'node:path'

export class OutputReservations {
  private readonly reserved = new Set<string>()

  private key(target: string): string {
    return path.resolve(target).toLocaleLowerCase('en-US')
  }

  async reserve(requested: string, allowExistingOverwrite: boolean): Promise<string> {
    const extension = path.extname(requested)
    const basename = path.basename(requested, extension)
    const directory = path.dirname(requested)
    let index = 0
    while (true) {
      const candidate =
        index === 0 ? requested : path.join(directory, `${basename} (${index})${extension}`)
      const key = this.key(candidate)
      const exists = await access(candidate).then(
        () => true,
        () => false
      )
      if (!this.reserved.has(key) && (!exists || (allowExistingOverwrite && index === 0))) {
        this.reserved.add(key)
        return candidate
      }
      index += 1
    }
  }

  release(target: string): void {
    this.reserved.delete(this.key(target))
  }
}
