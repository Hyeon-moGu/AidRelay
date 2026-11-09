// FakeFirestore with serializable transactions. The base fake commits whatever a transaction buffered,
// even when another transaction changed a document it read in between (a lost update real Firestore never
// allows). This one remembers every document and every query result a transaction read and, at commit,
// retries the transaction function if any of them changed (a query counts as changed when a document
// entered, left or changed inside its range), as Firestore does on contention. Commit is synchronous, so
// the check and the writes are atomic with respect to other async work.
import { FakeDocRef, FakeFirestore, FakeQuery, FakeSnapshot, FakeTransaction, type FakeQuerySnapshot } from "./fake-firestore";

const queryKey = (r: FakeQuerySnapshot): string => JSON.stringify(r.docs.map((d) => [d.id, d.data() ?? null]));

class TrackingTransaction extends FakeTransaction {
  private readonly reads: Array<[FakeDocRef, string]> = [];
  private readonly queryReads: Array<[FakeQuery, string]> = [];
  get(ref: FakeDocRef): Promise<FakeSnapshot>;
  get(query: FakeQuery): Promise<FakeQuerySnapshot>;
  async get(target: FakeDocRef | FakeQuery): Promise<FakeSnapshot | FakeQuerySnapshot> {
    if (target instanceof FakeQuery) {
      const result = target._run();
      this.queryReads.push([target, queryKey(result)]);
      return result;
    }
    const snap = target._snapshot();
    this.reads.push([target, JSON.stringify(snap.data() ?? null)]);
    return snap;
  }
  unchanged(): boolean {
    return (
      this.reads.every(([ref, seen]) => JSON.stringify(ref._snapshot().data() ?? null) === seen) &&
      this.queryReads.every(([query, seen]) => queryKey(query._run()) === seen)
    );
  }
}

export class OccFirestore extends FakeFirestore {
  /** Transactions retried because a document they read changed before they committed. */
  conflicts = 0;
  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = new TrackingTransaction();
      const result = await fn(tx);
      if (tx.unchanged()) {
        tx._commit();
        return result;
      }
      this.conflicts++;
    }
    throw new Error("10 ABORTED: too much contention on these documents");
  }
}
