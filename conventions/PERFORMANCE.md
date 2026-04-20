# Performance

This convention defines how to write code that avoids unnecessary work. The principles are language-agnostic; examples are shown in both TypeScript and Go.

Match data structures to access patterns. If you look up by key, use a hash map. If you test membership, use a set. If you scan linearly through a hash map, you chose wrong.

TypeScript: `const idx = new Map<string, Order>(); idx.get(orderId);` not `orders.find(o => o.id === orderId);`
Go: `idx := map[string]*Order{}; o := idx[orderID]` not `for _, o := range orders { if o.ID == orderID { ... } }`

Bound every collection that grows over time. Every accumulating structure needs a capacity limit, an eviction strategy, or both. An unbounded array is a memory leak with a delay. Use a ring buffer or fixed-size window -never shift elements to make room.

TypeScript: `buf[head % cap] = item; head++;` -circular index into a preallocated array. Never `arr.shift()` to evict, that is O(n).
Go: `ring.buf[ring.head%ring.cap] = item; ring.head++` -same pattern. Preallocate with `make([]T, cap)`, write by index, wrap with modulo.

Exit early and scan less. If you can answer a question with a direct lookup, do not iterate. If you must iterate, break the moment you have an answer. Never do O(n) when a structure gives you O(1).

TypeScript: `for (const item of items) { if (match(item)) return item; }` not `items.filter(match)[0];`
Go: `for _, item := range items { if match(item) { return item, nil } }` -never collect into a slice just to take the first element.

Do not poll what you can signal. If you are in a loop with a sleep, you probably want an event, a channel, or a callback instead. Polling wastes cycles when nothing has changed and adds latency when something has.

TypeScript: `await new Promise(resolve => emitter.once('done', resolve));` not `while (!done) { await sleep(50); }`
Go: `<-doneCh` not `for { select { case <-time.After(50 * time.Millisecond): if done.Load() { return } } }`

Avoid allocations on hot paths. Do not create objects, closures, or slices inside tight loops. Preallocate structures when the shape is known. Reuse buffers across iterations.

TypeScript: `const buf = new Float64Array(n); for (...) { buf[i] = compute(); }` not `for (...) { results.push({ value: compute() }); }`
Go: `buf := make([]float64, 0, n); for ... { buf = append(buf, compute()) }` -preallocate capacity. Avoid `make([]T, 0)` without a capacity hint in hot loops.

Copy less data. Do not duplicate what you can reference. Do not serialize what stays in-process. Prefer slices, views, and pointers over full copies when ownership is clear and the lifecycle allows it.

TypeScript: `const subset = buf.subarray(start, end);` not `const subset = buf.slice(start, end);` -subarray shares memory, slice copies.
Go: `func process(item *Order)` not `func process(item Order)` -pass a pointer to avoid copying the struct on every call.

Batch mutations. One operation touching many items beats many operations touching one item. Fewer round trips, fewer flushes, fewer context switches.

TypeScript: `db.exec(bulkInsertSQL, flatParams);` -build a single parameterized statement for N rows. Not `for (const r of rows) { db.exec(insertSQL, [r.a, r.b]); }`
Go: `tx.Exec(ctx, bulkInsertSQL, flatParams...)` not `for _, r := range rows { tx.Exec(ctx, insertSQL, r.A, r.B) }`

Choose the right complexity class before optimizing constants. Getting O(n²) down to O(n log n) matters more than shaving microseconds off an inner loop. Pick algorithms and structures that match the expected scale before writing any code.

TypeScript: `const set = new Set(listA); for (const b of listB) { if (set.has(b)) ... }` -O(n+m) instead of nested loops at O(n×m).
Go: `seen := make(map[string]struct{}, len(listA)); for _, a := range listA { seen[a] = struct{}{} }; for _, b := range listB { if _, ok := seen[b]; ok { ... } }`

Reduce coordination on hot paths. Shared mutable state requires synchronization. Synchronization requires waiting. Prefer per-worker or per-context state over shared structures protected by locks. When sharing is unavoidable, narrow the critical section to the minimum possible scope.

TypeScript: `function createWorker() { const local = new Map(); return { process(item) { local.set(item.id, item); } }; }` -each worker owns its state, no contention.
Go: `type worker struct { local map[string]*Item }` -per-goroutine state. Share results via channels at batch boundaries, not per-item locks.

These rules together produce code that stays fast as data grows. When performance degrades, the answer is almost always one of: wrong structure, unbounded collection, unnecessary scan, polling loop, hot-path allocation, unnecessary copy, missing batch, or excessive coordination. Check in that order.
