---
title: "JSON Logic Without Models"
date: 2024-04-18 09:00:00 +1200
tags: [json-logic, architecture, performance]
toc: true
pin: false
---

Holy performance increase, Batman!

I recently made an update to _JsonLogic.Net_ that cut run times and memory usage **in half**!

## In half?!

Yes!  Here's the benchmark:

| Method | Count | Mean         | Error       | StdDev      | Gen0       | Allocated   |
|------- |------ |-------------:|------------:|------------:|-----------:|------------:|
| Models | 1     |   1,655.9 us |    26.76 us |    26.28 us |   410.1563 |   838.03 KB |
| Nodes  | 1     |     734.5 us |     8.16 us |     7.23 us |   236.3281 |   482.61 KB |
| Models | 10    |  16,269.0 us |   167.06 us |   139.50 us |  4093.7500 |   8380.5 KB |
| Nodes  | 10    |   7,210.7 us |    25.26 us |    21.09 us |  2359.3750 |  4826.08 KB |
| Models | 100   | 164,267.3 us | 2,227.54 us | 1,974.66 us | 41000.0000 | 83803.81 KB |
| Nodes  | 100   |  72,195.7 us |   139.28 us |   116.30 us | 23571.4286 | 48262.05 KB |

In this table, "Models" is the old way, and "Nodes" is the new way.

As you can see, "Nodes" takes less than half as long to run, and it uses just over half the memory.

## What do "Models" and "Nodes" represent?

From the initial release of the library, JSON Logic is represented using its own object model via the `Rule` abstraction.  It would result in a large tree structure of strongly typed rules.  This is "Models".

The benefit of this approach is that strong typing, meaning that if you wanted to build some logic in code, you could use the associated builder methods on the static `JsonLogic` class and you didn't have to worry about getting argument types wrong.

However, as you can expect, building out this rule tree means heap allocations, and allocations, in general, are slow.

The "Nodes" approach, introduced with v5.2.0, doesn't use the object model.  Instead, the system is stateless.  It uses `JsonNode` to represent the logic, and the system runs "static" handlers depending on which operation key is present.  This is the approach that I took with JSON-e, and it worked out so well that I wanted to see where else I could apply it.

> I've had several attempts at making this approach for JSON Schema, and while it works, the performance isn't there yet.
{: .prompt-info}

JSON-e and JSON Logic also share a common basic design: they're both JSON representations of instructions that are processed with some kind of context data.

## So no more strong typing?

I think that's where I want to take this library.  With all of the soft typing and implicit conversions that JSON Logic uses anyway, I don't think it's going to be much of a problem for users.

Even on the [JSON Logic playground](https://jsonlogic.com/), you enter your logic and data as JSON and it runs from there.  I don't see why this library can't work the same way.

I don't really see a reason to need an object model.  (And with functional programming on the rise, maybe this stateless approach is the way of the future.)

But ultimately, it comes down to you.  Have a play with the new setup.  The [docs](https://docs.json-everything.net/logic/basics/) are already updated.  I'd like to hear what you think.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
