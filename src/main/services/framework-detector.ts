import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DetectedFramework, FrameworkId } from '../../shared/model'
import { PRESETS } from '../../shared/presets'

const exists = async (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false
  )

export async function detectFrameworks(root: string): Promise<DetectedFramework[]> {
  const detections = new Map<FrameworkId, string[]>()
  const add = (id: FrameworkId, evidence: string): void => {
    detections.set(id, [...(detections.get(id) ?? []), evidence])
  }

  let packageJson: Record<string, unknown> | null = null
  try {
    packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    /* not a JS project */
  }
  if (packageJson) {
    const dependencies = {
      ...((packageJson.dependencies as Record<string, string> | undefined) ?? {}),
      ...((packageJson.devDependencies as Record<string, string> | undefined) ?? {})
    }
    if (dependencies.next) add('nextjs', 'package.json: next')
    else if (dependencies.react) add('react', 'package.json: react')
    if (dependencies.vue || dependencies.nuxt)
      add('vue', `package.json: ${dependencies.nuxt ? 'nuxt' : 'vue'}`)
    if (dependencies['@angular/core']) add('angular', 'package.json: @angular/core')
    if (dependencies.svelte || dependencies['@sveltejs/kit']) add('svelte', 'package.json: svelte')
    if (dependencies.electron) add('electron', 'package.json: electron')
    if (detections.size === 0) add('node', 'package.json')
  }

  const markers: Array<[FrameworkId, string]> = [
    ['dotnet', '*.sln or *.csproj'],
    ['python', 'pyproject.toml'],
    ['python', 'requirements.txt'],
    ['java', 'pom.xml'],
    ['java', 'build.gradle'],
    ['go', 'go.mod'],
    ['rust', 'Cargo.toml']
  ]
  const rootNames = await readdir(root).catch(() => [] as string[])
  if (rootNames.some((name) => name.endsWith('.sln') || name.endsWith('.csproj')))
    add('dotnet', markers[0]![1])
  for (const [id, marker] of markers.slice(1))
    if (await exists(path.join(root, marker))) add(id, marker)

  if (detections.size === 0) add('generic', 'No known framework marker found')
  return [...detections].map(([id, evidence]) => ({ id, name: PRESETS[id].name, evidence }))
}
