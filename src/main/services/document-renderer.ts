import type { OutputFormat } from '../../shared/model'

type TreeNode = { files: Set<string>; directories: Map<string, TreeNode> }

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { files: new Set(), directories: new Map() }
  for (const value of paths) {
    const segments = value.replaceAll('\\', '/').split('/').filter(Boolean)
    let current = root
    for (const segment of segments.slice(0, -1)) {
      let child = current.directories.get(segment)
      if (!child) {
        child = { files: new Set(), directories: new Map() }
        current.directories.set(segment, child)
      }
      current = child
    }
    const filename = segments.at(-1)
    if (filename) current.files.add(filename)
  }
  return root
}

function treeLines(node: TreeNode, prefix = ''): string[] {
  const entries = [
    ...[...node.directories].map(([name, child]) => ({ name, child, directory: true })),
    ...[...node.files].map((name) => ({ name, child: null, directory: false }))
  ].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }))
  return entries.flatMap((entry, index) => {
    const last = index === entries.length - 1
    const line = `${prefix}${last ? '└── ' : '├── '}${entry.name}${entry.directory ? '/' : ''}`
    if (!entry.directory || !entry.child) return [line]
    return [line, ...treeLines(entry.child, `${prefix}${last ? '    ' : '│   '}`)]
  })
}

export function projectTree(projectName: string, paths: string[]): string {
  return [projectName, ...treeLines(buildTree(paths), '')].join('\n')
}

export function documentStart(format: OutputFormat, projectName: string, paths: string[]): string {
  const tree = projectTree(projectName, paths)
  if (format === 'markdown')
    return `# ${projectName}\n\n## Project Tree\n\n\`\`\`text\n${tree}\n\`\`\`\n\n## Files\n\n`
  return `${projectName}\n${'='.repeat(Math.max(projectName.length, 8))}\n\nPROJECT TREE\n------------\n${tree}\n\nFILES\n-----\n\n`
}

export function fileStart(format: OutputFormat, relativePath: string, fenceLength = 3): string {
  if (format === 'markdown')
    return `### ${relativePath}\n\n${'`'.repeat(Math.max(3, fenceLength))}\n`
  return `FILE: ${relativePath}\n${'-'.repeat(Math.max(20, relativePath.length + 6))}\n`
}

export function fileEnd(
  format: OutputFormat,
  fenceLength = 3,
  contentEndsWithNewline = false
): string {
  const separator = contentEndsWithNewline ? '' : '\n'
  if (format === 'markdown') return `${separator}${'`'.repeat(Math.max(3, fenceLength))}\n\n`
  return `${separator}\n${'='.repeat(72)}\n\n`
}
