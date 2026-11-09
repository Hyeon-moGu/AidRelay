// A small in-memory stand-in for the firebase-admin Firestore surface the repos use:
// collection/doc get-set-update-create-delete, where/orderBy/limit queries, runTransaction with
// buffered writes, dotted update paths, FieldValue.arrayUnion, FieldValue.delete and ignoreUndefinedProperties semantics.
import { Timestamp } from "firebase-admin/firestore";

type Doc = Record<string, unknown>;

function isLeaf(v: unknown): boolean {
  return v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Timestamp || typeof (v as { toMillis?: unknown }).toMillis === "function";
}

function clone<T>(v: T): T {
  if (isLeaf(v)) return Array.isArray(v) ? (v.map(clone) as unknown as T) : v;
  const out: Doc = {};
  for (const [k, val] of Object.entries(v as Doc)) if (val !== undefined) out[k] = clone(val);
  return out as T;
}

function deepMerge(target: Doc, src: Doc): void {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (isDelete(v)) {
      delete target[k];
      continue;
    }
    const cur = target[k];
    if (!isLeaf(v) && cur && !isLeaf(cur)) deepMerge(cur as Doc, v as Doc);
    else target[k] = clone(v);
  }
}

function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Doc)[part];
  }
  return cur;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = doc;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] === null || isLeaf(cur[part])) cur[part] = {};
    cur = cur[part] as Doc;
  }
  cur[parts[parts.length - 1]] = value;
}

function isArrayUnion(v: unknown): v is { elements: unknown[] } {
  return !!v && typeof v === "object" && v.constructor?.name === "ArrayUnionTransform" && Array.isArray((v as { elements?: unknown }).elements);
}

/** FieldValue.delete(): removes the field in update() and in set() with merge, as Firestore does. */
function isDelete(v: unknown): boolean {
  return !!v && typeof v === "object" && v.constructor?.name === "DeleteTransform";
}

function deletePath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const part of parts.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Doc)[part];
  }
  if (cur !== null && typeof cur === "object") delete (cur as Doc)[parts[parts.length - 1]];
}

function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Timestamp ? a.toMillis() : a;
  const bv = b instanceof Timestamp ? b.toMillis() : b;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Timestamp && b instanceof Timestamp) return a.toMillis() === b.toMillis();
  return a === b;
}

export class FakeSnapshot {
  constructor(
    public readonly id: string,
    private readonly doc: Doc | undefined,
  ) {}
  get exists(): boolean {
    return this.doc !== undefined;
  }
  data(): Doc | undefined {
    return this.doc ? clone(this.doc) : undefined;
  }
}

export class FakeDocRef {
  constructor(
    private readonly store: Map<string, Doc>,
    public readonly id: string,
    public readonly path: string,
  ) {}
  _exists(): boolean {
    return this.store.has(this.id);
  }
  _snapshot(): FakeSnapshot {
    return new FakeSnapshot(this.id, this.store.get(this.id));
  }
  _set(data: Doc, opts?: { merge?: boolean }): void {
    if (opts?.merge && this.store.has(this.id)) deepMerge(this.store.get(this.id)!, data);
    else this.store.set(this.id, clone(data));
  }
  _update(patch: Doc): void {
    const doc = this.store.get(this.id);
    if (!doc) throw new Error(`5 NOT_FOUND: no document to update: ${this.path}`);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (isDelete(v)) {
        deletePath(doc, k);
      } else if (isArrayUnion(v)) {
        const cur = getPath(doc, k);
        setPath(doc, k, [...(Array.isArray(cur) ? cur : []), ...v.elements.map(clone)]);
      } else {
        setPath(doc, k, clone(v));
      }
    }
  }
  _create(data: Doc): void {
    if (this.store.has(this.id)) throw new Error(`6 ALREADY_EXISTS: document already exists: ${this.path}`);
    this.store.set(this.id, clone(data));
  }
  _delete(): void {
    this.store.delete(this.id);
  }
  async get(): Promise<FakeSnapshot> {
    return this._snapshot();
  }
  async set(data: Doc, opts?: { merge?: boolean }): Promise<void> {
    this._set(data, opts);
  }
  async update(patch: Doc): Promise<void> {
    this._update(patch);
  }
  async create(data: Doc): Promise<void> {
    this._create(data);
  }
  async delete(): Promise<void> {
    this._delete();
  }
}

type Filter = { field: string; op: string; value: unknown };

export class FakeQuery {
  constructor(
    private readonly name: string,
    private readonly store: Map<string, Doc>,
    private readonly filters: Filter[] = [],
    private readonly order?: { field: string; dir: "asc" | "desc" },
    private readonly lim?: number,
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    return new FakeQuery(this.name, this.store, [...this.filters, { field, op, value }], this.order, this.lim);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): FakeQuery {
    return new FakeQuery(this.name, this.store, this.filters, { field, dir }, this.lim);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.name, this.store, this.filters, this.order, n);
  }
  async get(): Promise<{ empty: boolean; size: number; docs: FakeSnapshot[] }> {
    let rows = [...this.store.entries()].map(([id, doc]) => ({ id, doc }));
    for (const f of this.filters) {
      rows = rows.filter(({ doc }) => {
        const v = getPath(doc, f.field);
        switch (f.op) {
          case "==":
            return eq(v, f.value);
          case "!=":
            return !eq(v, f.value);
          case "in":
            return Array.isArray(f.value) && f.value.some((x) => eq(v, x));
          case ">=":
            return v !== undefined && cmp(v, f.value) >= 0;
          case ">":
            return v !== undefined && cmp(v, f.value) > 0;
          case "<=":
            return v !== undefined && cmp(v, f.value) <= 0;
          case "<":
            return v !== undefined && cmp(v, f.value) < 0;
          default:
            throw new Error(`fake firestore: unsupported operator ${f.op}`);
        }
      });
    }
    if (this.order) {
      const { field, dir } = this.order;
      rows = rows.filter(({ doc }) => getPath(doc, field) !== undefined);
      rows.sort((a, b) => cmp(getPath(a.doc, field), getPath(b.doc, field)) * (dir === "desc" ? -1 : 1));
    }
    if (this.lim !== undefined) rows = rows.slice(0, this.lim);
    const docs = rows.map(({ id, doc }) => new FakeSnapshot(id, doc));
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

export class FakeCollection extends FakeQuery {
  private static counter = 0;
  constructor(
    private readonly collName: string,
    private readonly collStore: Map<string, Doc>,
  ) {
    super(collName, collStore);
  }
  doc(id?: string): FakeDocRef {
    const docId = id ?? `auto-${++FakeCollection.counter}`;
    return new FakeDocRef(this.collStore, docId, `${this.collName}/${docId}`);
  }
}

export class FakeTransaction {
  private readonly writes: Array<() => void> = [];
  private readonly pendingCreates = new Set<string>();
  async get(ref: FakeDocRef): Promise<FakeSnapshot> {
    return ref._snapshot();
  }
  set(ref: FakeDocRef, data: Doc, opts?: { merge?: boolean }): this {
    this.writes.push(() => ref._set(data, opts));
    return this;
  }
  update(ref: FakeDocRef, patch: Doc): this {
    this.writes.push(() => ref._update(patch));
    return this;
  }
  create(ref: FakeDocRef, data: Doc): this {
    if (ref._exists() || this.pendingCreates.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: document already exists: ${ref.path}`);
    this.pendingCreates.add(ref.path);
    this.writes.push(() => ref._create(data));
    return this;
  }
  delete(ref: FakeDocRef): this {
    this.writes.push(() => ref._delete());
    return this;
  }
  _commit(): void {
    for (const w of this.writes) w();
  }
}

export class FakeFirestore {
  private readonly stores = new Map<string, Map<string, Doc>>();
  collection(name: string): FakeCollection {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return new FakeCollection(name, this.stores.get(name)!);
  }
  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction();
    const result = await fn(tx);
    tx._commit();
    return result;
  }
  settings(): void {}
  /** Test helper: raw document read. */
  read(name: string, id: string): Doc | undefined {
    const d = this.stores.get(name)?.get(id);
    return d ? clone(d) : undefined;
  }
  /** Test helper: every document of a collection. */
  all(name: string): Doc[] {
    return [...(this.stores.get(name)?.values() ?? [])].map(clone);
  }
}
