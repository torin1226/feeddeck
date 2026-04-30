// Print every unique uploader in ph_subs and per-uploader item count.
import { initDatabase, db } from '../database.js'
initDatabase()
const rows = db.prepare(
  `SELECT uploader, COUNT(*) AS n FROM persistent_row_items
   WHERE row_key = 'ph_subs' GROUP BY uploader ORDER BY n DESC`
).all()
console.log(`Total unique uploaders: ${rows.length}`)
for (const r of rows) console.log(`  ${String(r.n).padStart(3)}  ${r.uploader}`)
