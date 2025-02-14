
import path from 'path'
import PnpmError from '@pnpm/error'
import { sync as _canWriteToDir } from 'can-write-to-dir'

import isWindows from 'is-windows'
import globalBinDir from '../src/index'

const makePath =
  isWindows()
    ? (...paths: string[]) => `C:\\${path.join(...paths)}`
    : (...paths: string[]) => `/${path.join(...paths)}`

let canWriteToDir!: typeof _canWriteToDir
let readdirSync = (dir: string) => [] as Array<{ name: string, isDirectory: () => boolean }>
const FAKE_PATH = 'FAKE_PATH'

function makeFileEntry (name: string) {
  return { name, isDirectory: () => false }
}

function makeDirEntry (name: string) {
  return { name, isDirectory: () => true }
}

jest.mock('can-write-to-dir', () => ({
  sync: (dir: string) => canWriteToDir(dir),
}))

jest.mock('fs', () => {
  const originalModule = jest.requireActual('fs')
  return {
    ...originalModule,
    readdirSync: (dir: string) => readdirSync(dir),
  }
})

let originalPath: string | undefined

beforeEach(() => {
  originalPath = process.env[FAKE_PATH]
})

afterEach(() => {
  process.env[FAKE_PATH] = originalPath
})

jest.mock('path-name', () => 'FAKE_PATH')

const userGlobalBin = makePath('usr', 'local', 'bin')
const nodeGlobalBin = makePath('home', 'z', '.nvs', 'node', '12.0.0', 'x64', 'bin')
const npmGlobalBin = makePath('home', 'z', '.npm')
const pnpmGlobalBin = makePath('home', 'z', '.pnpm')
const npxGlobalBin = makePath('home', 'z', '.npm', '_npx', '123')
const otherDir = makePath('some', 'dir')
const currentExecDir = makePath('current', 'exec')
const dirWithTrailingSlash = `${makePath('current', 'slash')}${path.sep}`
const BIG_PATH = [
  npxGlobalBin,
  userGlobalBin,
  nodeGlobalBin,
  npmGlobalBin,
  otherDir,
  currentExecDir,
  dirWithTrailingSlash,
].join(path.delimiter)

test('prefer the pnpm home directory', () => {
  process.env[FAKE_PATH] = [
    npmGlobalBin,
    currentExecDir,
    nodeGlobalBin,
    pnpmGlobalBin,
  ].join(path.delimiter)
  canWriteToDir = () => true
  expect(globalBinDir()).toStrictEqual(pnpmGlobalBin)
})

test('fail if there is no write access to the pnpm home directory', () => {
  process.env[FAKE_PATH] = [
    npmGlobalBin,
    currentExecDir,
    nodeGlobalBin,
    pnpmGlobalBin,
  ].join(path.delimiter)
  canWriteToDir = (dir) => dir !== pnpmGlobalBin
  expect(() => globalBinDir()).toThrow(`The CLI has no write access to the pnpm home directory at ${pnpmGlobalBin}`)
})

test('prefer a directory that has "nodejs" or "npm" in the path', () => {
  process.env[FAKE_PATH] = BIG_PATH
  canWriteToDir = () => true
  expect(globalBinDir()).toStrictEqual(nodeGlobalBin)

  canWriteToDir = (dir) => dir !== nodeGlobalBin
  expect(globalBinDir()).toStrictEqual(npmGlobalBin)
})

test('prefer directory that is passed in as a known suitable location', () => {
  process.env[FAKE_PATH] = BIG_PATH
  canWriteToDir = () => true
  expect(globalBinDir([userGlobalBin])).toStrictEqual(userGlobalBin)
})

test("ignore directories that don't exist", () => {
  process.env[FAKE_PATH] = BIG_PATH
  canWriteToDir = (dir) => {
    if (dir === nodeGlobalBin) {
      const err = new Error('Not exists')
      err['code'] = 'ENOENT'
      throw err
    }
    return true
  }
  expect(globalBinDir()).toEqual(npmGlobalBin)
})

test('prefer the directory of the currently executed nodejs command', () => {
  process.env[FAKE_PATH] = BIG_PATH
  const originalExecPath = process.execPath
  process.execPath = path.join(currentExecDir, 'n')
  canWriteToDir = (dir) => dir !== nodeGlobalBin && dir !== npmGlobalBin && dir !== pnpmGlobalBin
  expect(globalBinDir()).toEqual(currentExecDir)

  process.execPath = path.join(dirWithTrailingSlash, 'n')
  expect(globalBinDir()).toEqual(dirWithTrailingSlash)

  process.execPath = originalExecPath
})

test('when the process has no write access to any of the suitable directories, throw an error', () => {
  process.env[FAKE_PATH] = BIG_PATH
  canWriteToDir = (dir) => dir === otherDir
  let err!: PnpmError
  try {
    globalBinDir()
  } catch (_err) {
    err = _err
  }
  expect(err).toBeDefined()
  expect(err.code).toEqual('ERR_PNPM_GLOBAL_BIN_DIR_PERMISSION')
})

test('when the process has no write access to any of the suitable directories, but opts.shouldAllowWrite is false, return the first match', () => {
  process.env[FAKE_PATH] = BIG_PATH
  canWriteToDir = (dir) => dir === otherDir
  expect(globalBinDir([], { shouldAllowWrite: false })).toEqual(nodeGlobalBin)
})

test('throw an exception if non of the directories in the PATH are suitable', () => {
  process.env[FAKE_PATH] = [otherDir].join(path.delimiter)
  canWriteToDir = () => true
  let err!: PnpmError
  try {
    globalBinDir()
  } catch (_err) {
    err = _err
  }
  expect(err).toBeDefined()
  expect(err.code).toEqual('ERR_PNPM_NO_GLOBAL_BIN_DIR')
})

test('throw exception if PATH is not set', () => {
  delete process.env[FAKE_PATH]
  expect(() => globalBinDir()).toThrow(/Couldn't find a global directory/)
})

test('prefer a directory that has "Node" in the path', () => {
  const capitalizedNodeGlobalBin = makePath('home', 'z', '.nvs', 'Node', '12.0.0', 'x64', 'bin')
  process.env[FAKE_PATH] = capitalizedNodeGlobalBin

  canWriteToDir = () => true
  expect(globalBinDir()).toEqual(capitalizedNodeGlobalBin)
})

test('select a directory that has a node command in it', () => {
  const dir1 = makePath('foo')
  const dir2 = makePath('bar')
  process.env[FAKE_PATH] = [
    dir1,
    dir2,
  ].join(path.delimiter)

  canWriteToDir = () => true
  readdirSync = (dir) => dir === dir2 ? [makeFileEntry('node')] : []
  expect(globalBinDir()).toEqual(dir2)
})

test('do not select a directory that has a node directory in it', () => {
  const dir1 = makePath('foo')
  const dir2 = makePath('bar')
  process.env[FAKE_PATH] = [
    dir1,
    dir2,
  ].join(path.delimiter)

  canWriteToDir = () => true
  readdirSync = (dir) => dir === dir2 ? [makeDirEntry('node')] : []

  expect(() => globalBinDir()).toThrow(/Couldn't find a suitable/)
})

test('select a directory that has a node.bat command in it', () => {
  const dir1 = makePath('foo')
  const dir2 = makePath('bar')
  process.env[FAKE_PATH] = [
    dir1,
    dir2,
  ].join(path.delimiter)

  canWriteToDir = () => true
  readdirSync = (dir) => dir === dir2 ? [makeFileEntry('node.bat')] : []
  expect(globalBinDir()).toEqual(dir2)
})
