import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, existsSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { closeDatabase } from '../database.js'

// ============================================================
// SQLite WAL mode + shutdown checkpoint tests
// (Beelink prep, 2026-05-09)
//
// Two contracts:
//  1. WAL mode + PRAGMA optimize work on a real file-backed DB
//     using the same calls initDatabase() makes.
//  2. closeDatabase(handle) runs PRAGMA optimize + wal_checkpoint(TRUNCATE)
//     before close, leaving -wal at zero bytes so backups (rsync) of
//     the main file alone still see all committed data.
// ============================================================

let tmpDir
let dbPath

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fd-wal-test-'))
  dbPath = join(tmpDir, 'test.db')
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('SQLite WAL mode + PRAGMA optimize', () => {
  it('PRAGMA journal_mode = WAL switches the journal mode to wal on a file-backed DB', () => {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    const mode = db.prepare('PRAGMA journal_mode').get()
    expect(mode.journal_mode).toBe('wal')
    db.close()
  })

  it('PRAGMA optimize runs without throwing and returns no rows', () => {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    db.exec("INSERT INTO t (val) VALUES ('a'), ('b'), ('c')")
    expect(() => db.exec('PRAGMA optimize')).not.toThrow()
    db.close()
  })

  it('a -wal file is created when WAL mode is on and writes occur', () => {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    db.exec('INSERT INTO t (id) VALUES (1)')
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    db.close()
  })
})

describe('closeDatabase', () => {
  it('returns silently on a null handle', () => {
    expect(() => closeDatabase(null)).not.toThrow()
  })

  it('runs PRAGMA optimize, wal_checkpoint(TRUNCATE), and db.close() in order', () => {
    const calls = []
    const fakeDb = {
      exec: vi.fn((sql) => { calls.push(`exec:${sql}`) }),
      prepare: vi.fn((sql) => {
        calls.push(`prepare:${sql}`)
        return { get: () => { calls.push(`get:${sql}`); return { busy: 0, log: 0, checkpointed: 0 } } }
      }),
      close: vi.fn(() => { calls.push('close') }),
    }
    closeDatabase(fakeDb)
    expect(calls).toEqual([
      'exec:PRAGMA optimize',
      'prepare:PRAGMA wal_checkpoint(TRUNCATE)',
      'get:PRAGMA wal_checkpoint(TRUNCATE)',
      'close',
    ])
  })

  it('still closes the DB if PRAGMA optimize throws', () => {
    const fakeDb = {
      exec: vi.fn(() => { throw new Error('optimize failed') }),
      prepare: vi.fn(() => ({ get: vi.fn() })),
      close: vi.fn(),
    }
    closeDatabase(fakeDb)
    expect(fakeDb.prepare).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)')
    expect(fakeDb.close).toHaveBeenCalled()
  })

  it('still closes the DB if wal_checkpoint throws', () => {
    const fakeDb = {
      exec: vi.fn(),
      prepare: vi.fn(() => { throw new Error('checkpoint failed') }),
      close: vi.fn(),
    }
    closeDatabase(fakeDb)
    expect(fakeDb.close).toHaveBeenCalled()
  })

  it('truncates the -wal file on a real DB so rsync of main file alone sees all data', () => {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)')
    const insert = db.prepare('INSERT INTO t (val) VALUES (?)')
    for (let i = 0; i < 100; i++) insert.run(`row-${i}`)

    const walBefore = statSync(`${dbPath}-wal`).size
    expect(walBefore).toBeGreaterThan(0)

    closeDatabase(db)

    // After TRUNCATE checkpoint + close, -wal should be 0 bytes (or absent).
    const walAfterExists = existsSync(`${dbPath}-wal`)
    if (walAfterExists) {
      expect(statSync(`${dbPath}-wal`).size).toBe(0)
    }

    // Reopen and confirm all 100 rows persisted to the main file.
    const db2 = new DatabaseSync(dbPath)
    const count = db2.prepare('SELECT COUNT(*) AS n FROM t').get()
    expect(count.n).toBe(100)
    db2.close()
  })
})
