/**
 * Read-only survey of duplicate restaurant records.
 *
 * Writes nothing. Run this before dedupe-restaurants.js to see what is there
 * and to decide whether the extra copies can simply go or have to be merged.
 *
 *   node scripts/dup-scan.js
 */
const { MongoClient } = require('mongodb');
require('dotenv').config();

const COMPARED = [
  'tenQuan', 'diaChi', 'giaCa', 'gioMoCua', 'tags', 'reviewCount',
  'diemTrungBinh', 'diemChatLuong', 'diemViTri', 'diemKhongGian',
  'diemPhucVu', 'diemGiaCa', 'avatarUrl', 'lat', 'lon',
];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'VietNomNom');
  const col = db.collection('restaurants');

  console.log('restaurants :', await col.countDocuments());
  console.log('reviews     :', await db.collection('reviews').countDocuments());

  const groups = await col
    .aggregate([
      { $group: { _id: '$urlGoc', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  const extra = groups.reduce((sum, g) => sum + g.n - 1, 0);
  console.log('dup groups  :', groups.length, '| extra rows:', extra,
              '| largest group:', groups[0] ? groups[0].n : 0);

  // Whether the copies differ decides the whole strategy: identical copies can
  // just be dropped, differing ones need their fields reconciled.
  let identical = 0;
  const differing = [];
  for (const g of groups) {
    const docs = await col.find({ urlGoc: g._id }).toArray();
    const sig = docs.map((d) => JSON.stringify(COMPARED.map((k) => d[k] ?? null)));
    if (sig.every((x) => x === sig[0])) identical++;
    else differing.push({ urlGoc: g._id, docs });
  }
  console.log('identical   :', identical, '| differing:', differing.length);

  // Does the review count actually split across copies? The case for dedupe
  // rests on this: if every copy carries the same count, no score is affected.
  const counts = new Set();
  for (const g of groups.slice(0, 200)) {
    const docs = await col.find({ urlGoc: g._id }).project({ reviewCount: 1 }).toArray();
    counts.add(new Set(docs.map((d) => d.reviewCount ?? 0)).size === 1);
  }
  console.log('every copy has the same reviewCount:', !counts.has(false));

  for (const { urlGoc, docs } of differing.slice(0, 3)) {
    console.log('\n--- copies differ ---', urlGoc.slice(-46));
    for (const d of docs) {
      const diff = COMPARED.filter(
        (k) => JSON.stringify(d[k] ?? null) !== JSON.stringify(docs[0][k] ?? null),
      );
      console.log('  _id', String(d._id), '| differs on:', diff.join(', ') || '(none)');
      for (const k of diff) console.log('      ', k, '=', String(d[k]).slice(0, 70));
    }
  }

  await client.close();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
