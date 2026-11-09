// FakeFirestore with serializable transactions. The base fake commits whatever a transaction buffered,
// even when another transaction changed a document it read in between (a lost update real Firestore never
// allows). This one remembers every document a transaction read and, at commit, retries the transaction
// function if any of them changed, as Firestore does on contention. Commit is synchronous, so the check and
// the writes are atomic with respect to other async work.
import { FakeDocRef, FakeFirestore, FakeSnapshot, FakeTransaction } from "./fake-firestore";

class TrackingTransaction extends FakeTransaction {
  private readonly reads: Array<[FakeDocRef, string]> = [];
  async get(ref: FakeDocRef): Promise<FakeSnapshot> {
    const snap = ref._snapshot();
    this.reads.push([ref, JSON.stringify(snap.data() ?? null)]);
    return snap;
  }
  unchanged(): boolean {
    return this.reads.every(([ref, seen]) => JSON.stringify(ref._snapshot().data() ?? null) === seen);
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
