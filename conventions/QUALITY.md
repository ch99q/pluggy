# Quality

This convention defines how to design libraries and APIs with predictable structure, clear naming, and stable long-term ergonomics. The principles are language-agnostic; examples are shown in both TypeScript and Go.

Root actions define the main entry points. These use a verb followed by a noun because they establish capabilities. They must stay simple and never hide side-effects or global state.
TypeScript: `const session = await createSession({ userId: 'u1', ttl: 300 });`
Go: `session, err := CreateSession(ctx, SessionOptions{UserID: "u1", TTL: 300})`

Returned objects represent categories. A category narrows the scope and exposes only what is meaningful inside that scope. Their names are nouns such as accounts, positions, trades.
TypeScript: `const acc = session.accounts().get(0);`
Go: `acc := session.Accounts().Get(0)`

Actions inside categories are always single words. The category provides context, so actions remain concise: balance, deposit, withdraw, status, list. This avoids verbose, overly descriptive names because the context already carries meaning.
TypeScript: `await acc.deposit({ amount: 200 });`
Go: `err := acc.Deposit(ctx, DepositParams{Amount: 200})`

Naming a function or method with a single word signals that it is a simple action or category. This sets expectations for how to use it and keeps the API surface clean. (Imagine the user had to speak with the API)
TypeScript: `const trades = session.trades().list();` not `const trades = session.getTradesList();`
Go: `trades := session.Trades().List(ctx)` not `trades := session.GetTradesList(ctx)`

Factories that create category objects are also single words. They mirror the category name and return only the actions relevant to that capability.
TypeScript: `function account(base, id) { return { balance: () => call({ base, id }, { path: 'x', fetch: {} }) }; }`
Go: `func (s *Session) Accounts() *AccountCategory { return &AccountCategory{ctx: s.ctx} }`

A single call function performs all backend communication. It receives a context and operation details. This centralizes validation, credentials, and error wrapping without introducing hidden magic.
TypeScript: `call(ctx, { path: 'account/0/balance', fetch: {} });`
Go: `call(ctx, op{Path: "account/0/balance"})`

The library forms a capability graph. Each step in the chain leads to a smaller and more precise set of actions. A developer discovers the API by following these chains rather than scanning large docs.
TypeScript: `session.trades().get(1).status();`
Go: `session.Trades().Get(1).Status(ctx)`

Errors must be explicit and fail early. Incorrect parameters, invalid IDs, or missing options should surface immediately. Nothing should silently continue.
TypeScript: `if (!opts) throw new Error('opts required');`
Go: `if opts == nil { return nil, errors.New("opts required") }`

Parallel actions behave predictably. Each action is an independent operation. Multiple requests can be combined without special helper abstractions.
TypeScript: `await Promise.all([ acc.balance(), target.balance() ]);`
Go: `g, ctx := errgroup.WithContext(ctx); g.Go(func() error { return acc.Balance(ctx) })`

Credentialed communication relies strictly on the context. This avoids global state and ensures each chain carries the correct authentication and metadata.
TypeScript: `headers: { 'X-User': base.userId }`
Go: `req.Header.Set("X-User", ctx.UserID)`

These rules together create libraries that remain consistent as domains grow. Developers understand the shape by learning it once, and every new category or action follows the same patterns.
