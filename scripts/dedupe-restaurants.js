/**
 * Merge duplicate restaurant records, keyed by urlGoc.
 *
 * What the data actually looks like (measured with scripts/dup-scan.js):
 *
 *   5707 restaurants, 27282 reviews
 *   201 duplicated urlGoc values, 201 extra rows, never more than 2 per group
 *   109 pairs byte-identical; the other 92 differ on `tags` and nothing else
 *   every copy of a pair carries the same reviewCount and the same scores
 *
 * That last line matters, because it contradicts the usual reason for doing
 * this: the reviews are keyed by urlGoc, not by restaurant _id, so a duplicate
 * row never split anyone's review count and no score is wrong because of it.
 * Deduping removes clutter from search results and shrinks the AI service's
 * in-memory frame. It does not change a single rating, and re-running the
 * rating pass afterwards is not needed.
 *
 * Reviews carry no restaurantId at all (checked: zero documents have the
 * field), so deleting a restaurant row orphans nothing.
 *
 * Rules:
 *   - keep the oldest _id in each group, because it is the one that has had
 *     the longest chance to be bookmarked or saved to somebody's list;
 *   - union the tags of every copy onto it, so the merge cannot lose an
 *     attribute, and drop repeats within the list while we are there;
 *   - abort if any copy in a group disagrees on a score or review count,
 *     rather than silently picking one.
 *
 * Usage:
 *   node scripts/dedupe-restaurants.js              # dry run + write backup
 *   node scripts/dedupe-restaurants.js --apply      # perform the merge
 *   node scripts/dedupe-restaurants.js --restore <backup.json>
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/** Fields that must agree across copies; disagreement means a human decides. */
const MUST_MATCH = [
  'reviewCount',
  'diemTrungBinh',
  'diemTrungBinhAdj',
  'diemChatLuong',
  'diemViTri',
  'diemKhongGian',
  'diemPhucVu',
  'diemGiaCa',
];

/** `tags` is an array on some documents and a stringified list on others. */
function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** Write tags back in whatever shape the kept document already used. */
function formatTags(tags, original) {
  if (Array.isArray(original)) return tags;
  return `['${tags.join("', '")}']`;
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in .env');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  return { client, db: client.db(process.env.DB_NAME || 'VietNomNom') };
}

async function restore(file) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { client, db } = await connect();
  const col = db.collection(payload.collection || 'restaurants');
  const { ObjectId } = require('mongodb');

  let restored = 0;
  for (const doc of payload.documents) {
    const _id = new ObjectId(doc._id);
    // replaceOne+upsert puts back both the rows that were deleted and the
    // pre-merge tags of the rows that were kept.
    const result = await col.replaceOne({ _id }, { ...doc, _id }, { upsert: true });
    if (result.modifiedCount || result.upsertedCount) restored += 1;
  }
  console.log(`Restored ${restored} of ${payload.documents.length} documents from`);
  console.log(`  ${file}`);
  await client.close();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const restoreIndex = process.argv.indexOf('--restore');
  if (restoreIndex !== -1) return restore(process.argv[restoreIndex + 1]);

  const { client, db } = await connect();
  const col = db.collection('restaurants');

  const groups = await col
    .aggregate([
      { $group: { _id: '$urlGoc', ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
    ])
    .toArray();

  if (groups.length === 0) {
    console.log('No duplicate urlGoc values. Nothing to do.');
    return client.close();
  }

  const affected = groups.flatMap((g) => g.ids);
  const documents = await col.find({ _id: { $in: affected } }).toArray();
  const byId = new Map(documents.map((d) => [String(d._id), d]));

  // --- Backup before anything else, always, even on a dry run -------------
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `restaurants-duplicates-${stamp}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        database: db.databaseName,
        collection: 'restaurants',
        note:
          'Every document involved in a duplicate group, exactly as stored ' +
          'before the merge. Restore with: node scripts/dedupe-restaurants.js ' +
          '--restore <this file>',
        groups: groups.length,
        count: documents.length,
        documents,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Backup written: ${path.relative(process.cwd(), backupFile)}`);
  console.log(`  ${documents.length} documents from ${groups.length} groups\n`);

  // --- Plan ---------------------------------------------------------------
  const plan = [];
  const conflicts = [];

  for (const group of groups) {
    const docs = group.ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      // ObjectId hex strings sort chronologically, so the smallest is oldest.
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));

    const clash = MUST_MATCH.filter((field) =>
      docs.some((d) => JSON.stringify(d[field] ?? null) !== JSON.stringify(docs[0][field] ?? null)),
    );
    if (clash.length) {
      conflicts.push({ urlGoc: group._id, fields: clash });
      continue;
    }

    const [keep, ...drop] = docs;
    const merged = [];
    for (const doc of docs) {
      for (const tag of parseTags(doc.tags)) {
        if (!merged.includes(tag)) merged.push(tag);
      }
    }
    const before = parseTags(keep.tags);
    plan.push({
      keep,
      drop,
      mergedTags: merged,
      tagsChanged: JSON.stringify(before) !== JSON.stringify(merged),
    });
  }

  const tagUpdates = plan.filter((p) => p.tagsChanged).length;
  const deletions = plan.reduce((sum, p) => sum + p.drop.length, 0);

  console.log(`Groups to merge : ${plan.length}`);
  console.log(`Tag merges      : ${tagUpdates}`);
  console.log(`Rows to delete  : ${deletions}`);
  console.log(`Conflicts       : ${conflicts.length}`);
  for (const c of conflicts.slice(0, 10)) {
    console.log(`  ! ${c.urlGoc} disagrees on ${c.fields.join(', ')} — left alone`);
  }

  const sample = plan.filter((p) => p.tagsChanged).slice(0, 3);
  if (sample.length) {
    console.log('\nSample tag merges:');
    for (const p of sample) {
      console.log(`  ${String(p.keep.tenQuan).slice(0, 44)}`);
      console.log(`    before: ${parseTags(p.keep.tags).join(', ')}`);
      console.log(`    after : ${p.mergedTags.join(', ')}`);
    }
  }

  if (!apply) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to perform it.');
    return client.close();
  }

  // --- Apply --------------------------------------------------------------
  const writes = plan
    .filter((p) => p.tagsChanged)
    .map((p) => ({
      updateOne: {
        filter: { _id: p.keep._id },
        update: { $set: { tags: formatTags(p.mergedTags, p.keep.tags) } },
      },
    }));

  if (writes.length) {
    const res = await col.bulkWrite(writes, { ordered: false });
    console.log(`\nTags merged on ${res.modifiedCount} kept documents.`);
  }

  const ids = plan.flatMap((p) => p.drop.map((d) => d._id));
  const del = await col.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${del.deletedCount} duplicate rows.`);
  console.log(`Remaining restaurants: ${await col.countDocuments()}`);
  console.log(`\nIf anything looks wrong: node scripts/dedupe-restaurants.js --restore ${path.relative(process.cwd(), backupFile)}`);

  await client.close();
}

main().catch((error) => {
  console.error('FAILED —', error.message);
  process.exit(1);
});
