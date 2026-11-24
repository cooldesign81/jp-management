"use strict";
// 테스트용 메모리 Firestore (firebase-admin 에서 쓰는 부분만: doc get/set/create/delete, collection where·get, runTransaction)
const DOC_ID = Symbol("documentId");
function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const writes = [];
  const snap = (path) => ({ exists: store.has(path), id: path.split("/").pop(), data: () => (store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined) });
  const doc = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => snap(path),
    set: async (data) => { writes.push(["set", path]); store.set(path, JSON.parse(JSON.stringify(data))); },
    create: async (data) => { if (store.has(path)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; } writes.push(["create", path]); store.set(path, JSON.parse(JSON.stringify(data))); },
    delete: async () => { writes.push(["delete", path]); store.delete(path); },
  });
  const query = (name, filters) => ({
    where: (field, op, value) => query(name, [...filters, [field, op, value]]),
    get: async () => {
      const docs = [];
      for (const [k, v] of store) {
        const parts = k.split("/");
        if (parts.length !== 2 || parts[0] !== name) continue;
        const id = parts[1];
        const ok = filters.every(([f, op, val]) => {
          const x = f === DOC_ID ? id : v[f];
          return op === "==" ? x === val : op === ">=" ? x >= val : op === "<" ? x < val : false;
        });
        if (ok) docs.push({ id, data: () => JSON.parse(JSON.stringify(v)) });
      }
      return { docs };
    },
  });
  return {
    store, writes, DOC_ID,
    doc,
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`), where: (f, op, v) => query(name, [[f, op, v]]), get: () => query(name, []).get() }),
    runTransaction: async (fn) => {
      const ops = [];
      const result = await fn({ get: (ref) => ref.get(), set: (ref, d) => ops.push(() => ref.set(d)), delete: (ref) => ops.push(() => ref.delete()) });
      for (const op of ops) await op();
      return result;
    },
  };
}
module.exports = { fakeDb, DOC_ID };
