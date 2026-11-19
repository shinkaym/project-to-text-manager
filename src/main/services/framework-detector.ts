import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DetectedFramework, FrameworkId } from '../../shared/model'
import { PRESETS } from '../../shared/presets'

const exists = async (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false
  )

function dependencyRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(root, 'package.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function hasFlutterSdkDependency(pubspec: string): boolean {
  let dependencySectionIndent: number | null = null
  let flutterDependencyIndent: number | null = null

  for (const rawLine of pubspec.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ').replace(/\s+#.*$/, '')

    const trimmed = line.trim()

    if (!trimmed) continue

    const indent = line.length - line.trimStart().length

    if (/^(dependencies|dev_dependencies)\s*:\s*$/.test(trimmed)) {
      dependencySectionIndent = indent
      flutterDependencyIndent = null
      continue
    }

    if (dependencySectionIndent === null) continue

    if (indent <= dependencySectionIndent) {
      dependencySectionIndent = null
      flutterDependencyIndent = null
      continue
    }

    if (/^flutter\s*:\s*\{\s*sdk\s*:\s*['"]?flutter['"]?\s*\}\s*$/.test(trimmed)) {
      return true
    }

    if (/^flutter\s*:\s*$/.test(trimmed)) {
      flutterDependencyIndent = indent
      continue
    }

    if (flutterDependencyIndent === null) continue

    if (indent <= flutterDependencyIndent) {
      flutterDependencyIndent = null
      continue
    }

    if (/^sdk\s*:\s*['"]?flutter['"]?\s*$/.test(trimmed)) {
      return true
    }
  }

  return false
}

async function detectFlutter(root: string): Promise<boolean> {
  try {
    const pubspec = await readFile(path.join(root, 'pubspec.yaml'), 'utf8')

    return hasFlutterSdkDependency(pubspec)
  } catch {
    return false
  }
}

export async function detectFrameworks(root: string): Promise<DetectedFramework[]> {
  const detections = new Map<FrameworkId, string[]>()

  const add = (id: FrameworkId, evidence: string): void => {
    const current = detections.get(id) ?? []

    if (current.includes(evidence)) return

    detections.set(id, [...current, evidence])
  }

  const packageJson = await readPackageJson(root)

  if (packageJson) {
    const dependencies = {
      ...dependencyRecord(packageJson.dependencies),
      ...dependencyRecord(packageJson.devDependencies),
      ...dependencyRecord(packageJson.peerDependencies),
      ...dependencyRecord(packageJson.optionalDependencies)
    }

    const hasReactNative = Boolean(dependencies['react-native'] || dependencies.expo)

    const hasNext = Boolean(dependencies.next)

    if (dependencies['react-native']) {
      add('react-native', 'package.json: react-native')
    }

    if (dependencies.expo) {
      add('react-native', 'package.json: expo')
    }

    if (hasNext) {
      add('nextjs', 'package.json: next')
    }

    if (dependencies.react && !hasReactNative && !hasNext) {
      add('react', 'package.json: react')
    }

    if (dependencies.vue || dependencies.nuxt) {
      add('vue', `package.json: ${dependencies.nuxt ? 'nuxt' : 'vue'}`)
    }

    if (dependencies['@angular/core']) {
      add('angular', 'package.json: @angular/core')
    }

    if (dependencies.svelte || dependencies['@sveltejs/kit']) {
      add('svelte', `package.json: ${dependencies['@sveltejs/kit'] ? '@sveltejs/kit' : 'svelte'}`)
    }

    if (dependencies.electron) {
      add('electron', 'package.json: electron')
    }
  }

  if (await detectFlutter(root)) {
    add('flutter', 'pubspec.yaml: flutter sdk')
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

  if (
    rootNames.some(
      (name) =>
        name.toLocaleLowerCase('en-US').endsWith('.sln') ||
        name.toLocaleLowerCase('en-US').endsWith('.csproj')
    )
  ) {
    add('dotnet', markers[0]![1])
  }

  for (const [id, marker] of markers.slice(1)) {
    if (await exists(path.join(root, marker))) {
      add(id, marker)
    }
  }

  if (detections.size === 0 && packageJson) {
    add('node', 'package.json')
  }

  if (detections.size === 0) {
    add('generic', 'No known framework marker found')
  }

  return [...detections].map(([id, evidence]) => ({
    id,
    name: PRESETS[id].name,
    evidence
  }))
}
