import type { FrameworkId } from './model'

export type FrameworkPreset = {
  id: FrameworkId
  name: string
  version: number
  include: string[]
  exclude: string[]
  hardExcludeDirectories: string[]
}

const commonExclude = ['**/*.lock', '**/*.min.js', '**/*.map', '**/*.log']
const source = ['**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,scss,html,md,yml,yaml}']

export const PRESETS: Record<FrameworkId, FrameworkPreset> = {
  react: {
    id: 'react',
    name: 'React',
    version: 1,
    include: [...source, 'src/**', 'public/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['.next', 'coverage']
  },
  nextjs: {
    id: 'nextjs',
    name: 'Next.js',
    version: 1,
    include: [...source, 'app/**', 'pages/**', 'src/**', 'public/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['.next', 'coverage']
  },
  vue: {
    id: 'vue',
    name: 'Vue',
    version: 1,
    include: [...source, '**/*.vue', 'src/**', 'public/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['.nuxt', '.output', 'coverage']
  },
  angular: {
    id: 'angular',
    name: 'Angular',
    version: 1,
    include: [...source, 'src/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['.angular', 'coverage']
  },
  svelte: {
    id: 'svelte',
    name: 'Svelte',
    version: 1,
    include: [...source, '**/*.svelte', 'src/**', 'static/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['.svelte-kit', 'coverage']
  },
  electron: {
    id: 'electron',
    name: 'Electron',
    version: 1,
    include: [...source, 'src/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['coverage']
  },
  node: {
    id: 'node',
    name: 'Node.js',
    version: 1,
    include: [...source, 'src/**', 'lib/**'],
    exclude: commonExclude,
    hardExcludeDirectories: ['coverage']
  },
  dotnet: {
    id: 'dotnet',
    name: '.NET',
    version: 1,
    include: ['**/*.{cs,csproj,sln,json,xml,config,md}'],
    exclude: commonExclude,
    hardExcludeDirectories: ['bin', 'obj', '.vs']
  },
  python: {
    id: 'python',
    name: 'Python',
    version: 1,
    include: ['**/*.{py,pyi,toml,cfg,ini,json,md,yml,yaml,txt}'],
    exclude: [...commonExclude, '**/*.pyc'],
    hardExcludeDirectories: ['__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache']
  },
  java: {
    id: 'java',
    name: 'Java',
    version: 1,
    include: ['**/*.{java,kt,kts,xml,gradle,properties,json,md,yml,yaml}'],
    exclude: commonExclude,
    hardExcludeDirectories: ['target', '.gradle']
  },
  go: {
    id: 'go',
    name: 'Go',
    version: 1,
    include: ['**/*.{go,mod,sum,json,md,yml,yaml}'],
    exclude: commonExclude,
    hardExcludeDirectories: []
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    version: 1,
    include: ['**/*.{rs,toml,json,md,yml,yaml}'],
    exclude: commonExclude,
    hardExcludeDirectories: ['target']
  },
  generic: {
    id: 'generic',
    name: 'Generic Project',
    version: 1,
    include: ['**/*'],
    exclude: commonExclude,
    hardExcludeDirectories: []
  }
}

export const BUILT_IN_HARD_EXCLUDES = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.idea',
  '.vs',
  'coverage',
  'tmp',
  'temp'
] as const
