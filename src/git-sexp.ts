import fs from 'fs'
import * as git from 'isomorphic-git'
import { ReadObjectResult, TreeEntry } from 'isomorphic-git'

export const GITDIR = 'git-sexp.git'

export interface GitSexpAtom {
  type: 'git-sexp-atom'
  value: string // This could be the content of a blob
  oid: string // The SHA-1 object id of the corresponding blob
}

export interface GitSexpCons {
  type: 'git-sexp-cons'
  car: GitSexpExpression
  cdr: GitSexpExpression
  oid: string // The SHA-1 object id of the corresponding tree
}

export interface GitSexpAtomLazy {
  type: 'git-sexp-atom-lazy'
  oid: string // The SHA-1 object id of the corresponding blob
}

export interface GitSexpConsLazy {
  type: 'git-sexp-cons-lazy'
  car?: GitSexpExpressionLazy
  cdr?: GitSexpExpressionLazy
  oid: string // The SHA-1 object id of the corresponding tree
}

export const GitSexpEmptyValue = {
  type: 'git-sexp-empty',
  oid: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', // Literal type for the empty tree hash
}

export type GitSexpEmpty = typeof GitSexpEmptyValue

export type GitSexpExpression = GitSexpAtom | GitSexpCons | GitSexpEmpty

export type GitSexpExpressionLazy =
  | GitSexpAtomLazy
  | GitSexpConsLazy
  | GitSexpEmpty

export type GitSexpList = GitSexpEmpty | GitSexpCons

export type JsEmptySexp = null

export type JsAtom = string

export type JsCons = [JsSexp, JsSexp]

export type JsSexp = JsEmptySexp | JsAtom | JsCons

export const HISTORY_BRANCH = 'history'

// type guard for JsAtom
export function isJsAtom(sexp: JsSexp): sexp is JsAtom {
  return typeof sexp === 'string'
}

// type guard for JsCons
export function isJsCons(sexp: JsSexp): sexp is JsCons {
  return Array.isArray(sexp) && sexp.length === 2
}

// type guard for JsEmptySexp
export function isJsEmptySexp(sexp: JsSexp): sexp is JsEmptySexp {
  return sexp === null
}

// Convert a flat array of strings into a JsCons linked list.
export function stringArrayToConsList(strings: string[]): JsSexp {
  return strings
    .reverse()
    .reduce((list: JsSexp, str: string): JsSexp => [str, list], null)
}

// Convert a JsCons linked list into a flat array of strings.
export function consListToStringArray(sexp: JsSexp): string[] {
  if (isJsEmptySexp(sexp)) {
    return []
  } else if (isJsAtom(sexp)) {
    return [sexp]
  } else if (isJsCons(sexp) && isJsAtom(sexp[0])) {
    const [car, cdr] = sexp
    return [car, ...consListToStringArray(cdr)]
  } else {
    throw new Error(`Invalid JsSexp type ${typeof sexp}`)
  }
}

export async function setupGitSexpRepo() {
  // init is idempotent, so it's safe to call it every time
  await git.init({
    gitdir: GITDIR,
    fs,
    bare: true,
    defaultBranch: HISTORY_BRANCH,
  })

  // set gc.auto to 0 to keep objects loose
  await git.setConfig({ gitdir: GITDIR, fs, path: 'gc.auto', value: '0' })

  // set author configs
  await git.setConfig({
    gitdir: GITDIR,
    fs,
    path: 'user.name',
    value: 'GitSexp',
  })

  await git.setConfig({
    gitdir: GITDIR,
    fs,
    path: 'user.email',
    value: 'git-sexp@localhost',
  })

  // check if repo was just created (i.e. default branch is empty), so create
  // initial commit with empty tree
  if (await isRepoEmpty()) {
    await git.commit({
      gitdir: GITDIR,
      fs,
      tree: GitSexpEmptyValue.oid,
      parent: [],
      message: 'Initial commit',
    })
  }
}

export async function updateBranchHead(sexpList: GitSexpList) {
  const headCommitOid = await git.resolveRef({
    gitdir: GITDIR,
    fs,
    ref: HISTORY_BRANCH,
  })

  // commit the GitSexpExpression oid as the tree of the new commit
  await git.commit({
    gitdir: GITDIR,
    fs,
    tree: sexpList.oid,
    parent: [headCommitOid],
    message: 'Append messages',
  })
}

export async function isRepoEmpty() {
  return (await git.listBranches({ gitdir: GITDIR, fs })).length === 0
}

export async function loadHistoryGitSexpList() {
  const headCommitOid = await git.resolveRef({
    gitdir: GITDIR,
    fs,
    ref: HISTORY_BRANCH,
  })

  const headCommit = await git.readCommit({
    gitdir: GITDIR,
    fs,
    oid: headCommitOid,
  })

  const headTreeOid = headCommit.commit.tree
  const gitSexp = await readGitSexpExpression(headTreeOid)
  return gitSexp
}

export async function readGitSexpExpression(
  oid: string
): Promise<GitSexpExpression> {
  // Base case for the empty expression
  if (oid === GitSexpEmptyValue.oid) {
    return { type: 'git-sexp-empty', oid: GitSexpEmptyValue.oid }
  }

  // Base case for an atom
  if (await isGitSexpAtomOid(oid)) {
    return await readGitSexpAtom(oid)
  }

  // Read the cons cell lazily
  const consLazy = await readGitSexpConsLazy(oid)

  // Recursively read car and cdr
  const car = consLazy.car
    ? await readGitSexpExpression(consLazy.car.oid)
    : undefined
  const cdr = consLazy.cdr
    ? await readGitSexpExpression(consLazy.cdr.oid)
    : undefined

  // Return the fully realized cons cell
  return {
    type: 'git-sexp-cons',
    car: car || GitSexpEmptyValue, // Handle the case where car or cdr might be undefined
    cdr: cdr || GitSexpEmptyValue,
    oid,
  }
}

export function gitSexpToJsSexp(sexp: GitSexpExpression): JsSexp {
  // base case
  if (sexp.type === 'git-sexp-empty') {
    return null
  }

  // leaf case
  else if (sexp.type === 'git-sexp-atom') {
    const atom = sexp as GitSexpAtom
    return atom.value
  }

  // recursive case
  else if (sexp.type === 'git-sexp-cons') {
    const cons = sexp as GitSexpCons
    const car = cons.car
    const cdr = cons.cdr

    const carStringArray = gitSexpToJsSexp(car)
    const cdrStringArray = gitSexpToJsSexp(cdr)

    return [carStringArray, cdrStringArray]
  }

  // should never happen
  else {
    throw new Error(`Invalid GitSexpExpression type ${sexp.type}`)
  }
}

export async function jsSexpToGitSexp(
  value: JsSexp
): Promise<GitSexpExpression> {
  // base case
  if (value === null || value === undefined) {
    return GitSexpEmptyValue
  }

  // leaf case
  else if (typeof value === 'string') {
    return await writeGitSexpAtom(value)
  }

  // recursive case
  else if (Array.isArray(value) && value.length === 2) {
    const car = await jsSexpToGitSexp(value[0])
    const cdr = await jsSexpToGitSexp(value[1])
    return await writeGitSexpCons({ car, cdr })
  }

  // should never happen
  else {
    throw new Error(`Invalid value type ${typeof value}`)
  }
}

export async function writeGitSexpListLazy(
  sexps: GitSexpExpressionLazy[]
): Promise<GitSexpExpressionLazy> {
  let currentSexp: GitSexpExpressionLazy = {
    type: 'git-sexp-empty',
    oid: GitSexpEmptyValue.oid,
  }

  // Iterate in reverse order to build the list from the end to the start
  for (let i = sexps.length - 1; i >= 0; i--) {
    const sexp = sexps[i]
    if (sexp !== null && sexp !== undefined) {
      currentSexp = await writeGitSexpConsLazy({ car: sexp, cdr: currentSexp })
    }
  }

  return currentSexp
}

function isValidGitSexpAtomObject(objectInfo: ReadObjectResult): boolean {
  return (
    objectInfo.type === 'blob' &&
    (objectInfo.format === 'content' || objectInfo.format === 'parsed')
  )
}

function isValidGitSexpConsObject(
  objectInfo: ReadObjectResult,
  tree: TreeEntry[]
): boolean {
  if (
    objectInfo.type !== 'tree' ||
    (objectInfo.format !== 'content' && objectInfo.format !== 'parsed')
  ) {
    return false
  }

  if (tree.length !== 2) {
    return false
  }

  const hasCar = tree.some((entry) => entry.path === 'car')
  const hasCdr = tree.some((entry) => entry.path === 'cdr')
  return hasCar && hasCdr
}

// write a string to a blob and return the oid
export async function writeGitSexpAtom(str: string): Promise<GitSexpAtom> {
  const oid = await git.writeBlob({
    gitdir: GITDIR,
    fs,
    blob: new Uint8Array(Buffer.from(str)),
  })

  // return oid;
  return {
    type: 'git-sexp-atom',
    value: str,
    oid: oid,
  }
}

// cons a string onto the head of a GitSexpCons
// - write the string as an atom
// - write the GitSexpCons with the atom as the car and the current GitSexpExpression
//   as the cdr
// - return the new GitSexpExpression
export async function consStringOntoGitSexpExpression(
  str: string,
  sexp: GitSexpExpression
): Promise<GitSexpExpression> {
  const atom = await writeGitSexpAtom(str)
  const cons = await writeGitSexpCons({ car: atom, cdr: sexp })
  return cons
}

export async function readGitSexpAtom(oid: string): Promise<GitSexpAtom> {
  const objectInfo = await git.readObject({ gitdir: GITDIR, fs, oid })

  if (isValidGitSexpAtomObject(objectInfo)) {
    if (
      objectInfo.format === 'parsed' &&
      typeof objectInfo.object === 'string'
    ) {
      return {
        type: 'git-sexp-atom',
        value: objectInfo.object,
        oid: oid,
      }
    } else {
      return {
        type: 'git-sexp-atom',
        value: Buffer.from(objectInfo.object as Uint8Array).toString(),
        oid: oid,
      }
    }
  } else {
    throw new Error('OID does not point directly to a blob')
  }
}

export async function readGitSexpConsLazy(
  oid: string
): Promise<GitSexpConsLazy> {
  const objectInfo = await git.readObject({ gitdir: GITDIR, fs, oid })

  let tree: TreeEntry[]
  if (objectInfo.format === 'parsed' && objectInfo.type === 'tree') {
    tree = objectInfo.object
  } else {
    const readTreeResult = await git.readTree({ gitdir: GITDIR, fs, oid })
    tree = readTreeResult.tree
  }

  if (!isValidGitSexpConsObject(objectInfo, tree)) {
    throw new Error(`OID ${oid} is not a valid Git Sexp Cons`)
  }

  // casting because we already know that the tree has the correct structure
  // from the isValidGitSexpConsObject check
  const carEntry = tree.find((entry) => entry.path === 'car') as TreeEntry
  const cdrEntry = tree.find((entry) => entry.path === 'cdr') as TreeEntry

  // figure out the git object type of the car and cdr and create the
  // corresponding lazy object
  // - if it's the empty tree oid, then it's a GitSexpEmpty
  // - if it's a blob type, then it's a GitSexpAtomLazy
  // - if it's a tree type, then it's a GitSexpConsLazy
  // use the data already returned from readObject or readTree to avoid
  // reading the object again
  const [car, cdr]: GitSexpExpressionLazy[] = [carEntry, cdrEntry].map(
    (entry: TreeEntry): GitSexpExpressionLazy => {
      if (entry.oid === GitSexpEmptyValue.oid) {
        return { type: 'git-sexp-empty', oid: GitSexpEmptyValue.oid }
      }
      if (entry.type === 'blob') {
        return { type: 'git-sexp-atom-lazy', oid: entry.oid }
      } else {
        return { type: 'git-sexp-cons-lazy', oid: entry.oid }
      }
    }
  )

  // return {oidCar: carEntry.oid, oidCdr: cdrEntry.oid};
  return {
    type: 'git-sexp-cons-lazy',
    car,
    cdr,
    oid,
  }
}

export async function isGitSexpConsOid(oid: string): Promise<boolean> {
  try {
    const objectInfo = await git.readObject({ gitdir: GITDIR, fs, oid })

    let tree: TreeEntry[] = []
    if (objectInfo.format === 'parsed' && objectInfo.type === 'tree') {
      tree = objectInfo.object
    } else {
      const readTreeResult = await git.readTree({ gitdir: GITDIR, fs, oid })
      tree = readTreeResult.tree
    }

    return isValidGitSexpConsObject(objectInfo, tree)
  } catch {
    return false
  }
}

export async function isGitSexpAtomOid(oid: string): Promise<boolean> {
  try {
    const objectInfo = await git.readObject({ gitdir: GITDIR, fs, oid })
    return isValidGitSexpAtomObject(objectInfo)
  } catch {
    return false
  }
}

export async function writeGitSexpConsLazy({
  car,
  cdr,
}: {
  car: GitSexpExpressionLazy
  cdr: GitSexpExpressionLazy
}): Promise<GitSexpConsLazy> {
  // Helper function to determine the type and mode
  function getTypeAndMode(sexp: GitSexpExpressionLazy): {
    type: 'blob' | 'tree'
    mode: string
  } {
    if (sexp.type === 'git-sexp-empty') {
      return { type: 'tree', mode: '040000' }
    } else if (sexp.type === 'git-sexp-atom-lazy') {
      return { type: 'blob', mode: '100644' }
    } else {
      return { type: 'tree', mode: '040000' }
    }
  }

  const carTypeAndMode = getTypeAndMode(car)
  const cdrTypeAndMode = getTypeAndMode(cdr)

  const tree = [
    {
      path: 'car',
      mode: carTypeAndMode.mode,
      type: carTypeAndMode.type,
      oid: car.oid,
    },
    {
      path: 'cdr',
      mode: cdrTypeAndMode.mode,
      type: cdrTypeAndMode.type,
      oid: cdr.oid,
    },
  ]

  const consOid = await git.writeTree({
    gitdir: GITDIR,
    fs,
    tree: tree,
  })

  return {
    type: 'git-sexp-cons-lazy',
    car,
    cdr,
    oid: consOid,
  }
}

export async function writeGitSexpCons({
  car,
  cdr,
}: {
  car: GitSexpExpression
  cdr: GitSexpExpression
}): Promise<GitSexpCons> {
  // Helper function to determine the type and mode
  function getTypeAndMode(sexp: GitSexpExpression): {
    type: 'blob' | 'tree'
    mode: string
  } {
    if (sexp.type === 'git-sexp-empty') {
      return { type: 'tree', mode: '040000' }
    } else if (sexp.type === 'git-sexp-atom') {
      return { type: 'blob', mode: '100644' }
    } else {
      return { type: 'tree', mode: '040000' }
    }
  }

  const carTypeAndMode = getTypeAndMode(car)
  const cdrTypeAndMode = getTypeAndMode(cdr)

  const tree = [
    {
      path: 'car',
      mode: carTypeAndMode.mode,
      type: carTypeAndMode.type,
      oid: car.oid,
    },
    {
      path: 'cdr',
      mode: cdrTypeAndMode.mode,
      type: cdrTypeAndMode.type,
      oid: cdr.oid,
    },
  ]

  const consOid = await git.writeTree({
    gitdir: GITDIR,
    fs,
    tree: tree,
  })

  return {
    type: 'git-sexp-cons',
    car,
    cdr,
    oid: consOid,
  }
}

// async function runTests() {
//   console.log('Starting tests...')

// }

if (import.meta.vitest) {
  const { test, expect, beforeAll, afterAll } = import.meta.vitest

  // setup and teardown test repo
  beforeAll(async () => {
    console.log('Setting up test repo...')
    await setupGitSexpRepo()
  })

  afterAll(() => {
    console.log('Tearing down test repo...')
    fs.rmSync(GITDIR, { recursive: true })
  })

  test('writes and reads back the same string', async () => {
    const testString = 'Hello, World!'
    const atom = await writeGitSexpAtom(testString)
    const readString = (await readGitSexpAtom(atom.oid)).value

    expect(readString).toBe(testString)
  })

  test('writes and reads back the empty string', async () => {
    const testString = ''
    const atom = await writeGitSexpAtom(testString)
    const readString = (await readGitSexpAtom(atom.oid)).value

    expect(readString).toBe(testString)
  })

  test('throws error when trying to read invalid OID', async () => {
    const invalidOid = '1234567890abcdef'

    await expect(readGitSexpAtom(invalidOid)).rejects.toThrow()
  })

  test('writes and reads back the same recursive cons structure', async () => {
    // Define each level as a separate variable
    const level3: JsSexp = ['d', null] // Level 3
    const level2: JsSexp = ['c', level3] // Level 2
    const level1: JsSexp = ['b', level2] // Level 1
    const level0: JsSexp = ['a', level1] // Level 0

    // Combine into the main array
    const testArrayCons: JsSexp = level0

    const sexp = await jsSexpToGitSexp(testArrayCons)
    const readArrayCons = gitSexpToJsSexp(sexp)

    expect(readArrayCons).toEqual(testArrayCons)

    // from oid
    const sexpFromOid = await readGitSexpExpression(sexp.oid)
    const readArrayConsFromOid = gitSexpToJsSexp(sexpFromOid)

    expect(readArrayConsFromOid).toEqual(testArrayCons)
  })
}
