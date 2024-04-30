---
title: "Better JSON Pointer"
date: 2024-04-30 09:00:00 +1200
tags: [json-pointer, architecture, performance, learning]
toc: true
pin: false
---

This post was going to be something else, and somewhat more boring.  Be glad you're not reading that.

But instead of blindly forging on, I stopped to consider whether I actually wanted to push out the changes I had made.  In the end, I'm glad I hesitated.

In this post and probably the couple that follow, I will cover my experience trying to squeeze some more performance out of a simple, immutable type.

## Current state (as it was)

The `JsonPointer` class is a typical object-oriented approach to implementing the JSON Pointer specification, RFC 6901.

Syntactically, a JSON Pointer is nothing more a series of string segments separated by forward slashes.  All of the pointer segments follow the same rule:  any tildes (`~`) or forward slashes (`/`) need to be escaped; otherwise, just use the string as-is.

Since all of the segments follow a rule, a class is created to model a segment (`PointerSegment`) and then a another class is created to house a series of them (`JsonPointer`).  Easy.

Tack on some functionality for parsing, evaluation, and maybe some pointer math (combining and building pointers), and you have a full implementation.

## An idea is formed

In thinking about how the model could be better, I realized that the class is immutable, and it doesn't directly hold a lot of data.  What if it were a struct?  Then it could live on the stack, eliminating a memory allocation.

Then, instead of holding a collection of strings, it could hold just the full string and a collection of `Range` objects could indicate the segments: one string allocation instead of an array of objects that hold strings.

This raises a question of whether the string should hold pointer-encoded segments.  If it did, then `.ToString()` could just return the string, eliminating the need to build it, and I could provide new allocation-free string comparison methods that accounted for encoding so that users could still operate on segments.

I implemented all of this, and it worked!  It actually worked quite well:

| Version| n     | Mean       | Error     | StdDev     | Gen0     | Allocated |
|------- |------ |-----------:|----------:|-----------:|---------:|----------:|
| v4.0.1 | 1     |   2.778 us | 0.0546 us |  0.1025 us |   4.1962 |   8.57 KB |
| v5.0.0 | 1     |   1.718 us | 0.0335 us | 0.0435 us  |   1.4915 |   3.05 KB |
| v4.0.1 | 10    |  26.749 us | 0.5000 us |  0.7330 us |  41.9617 |   85.7 KB |
| v5.0.0 | 10    |  16.719 us | 0.3219 us | 0.4186 us  |  14.8926 |  30.47 KB |
| v4.0.1 | 100   | 286.995 us | 5.6853 us | 12.5983 us | 419.4336 | 857.03 KB |
| v5.0.0 | 100   | 157.159 us | 2.5567 us | 2.1350 us  | 149.1699 | 304.69 KB |

... for parsing.  Pointer math was a bit different:

| Version| n     | Mean        | Error       | StdDev      | Gen0     | Allocated |
|------- |------ |------------:|------------:|------------:|---------:|----------:|
| v4.0.1 | 1     |    661.2 ns |    12.86 ns |    11.40 ns |   1.1473 |   2.34 KB |
| v5.0.0 | 1     |    916.3 ns |    17.46 ns |    15.47 ns |   1.1120 |   2.27 KB |
| v4.0.1 | 10    |  6,426.4 ns |   124.10 ns |   121.88 ns |  11.4746 |  23.44 KB |
| v5.0.0 | 10    |  9,128.2 ns |   180.82 ns |   241.39 ns |  11.1237 |  22.73 KB |
| v4.0.1 | 100   | 64,469.6 ns | 1,309.01 ns | 1,093.08 ns | 114.7461 | 234.38 KB |
| v5.0.0 | 100   | 92,437.0 ns | 1,766.38 ns | 1,963.33 ns | 111.3281 | 227.34 KB |

While the memory allocation decrease was... fine, the 50% run-time increase was unacceptable.  I couldn't figure out what was going on here, so I left it for about a week and started on some updates for _JsonSchema.Net_ (post coming soon).

Initially for the pointer math, I was just creating a new string and then parsing that.  The memory usage was a bit higher than what's shown above, but the run-time was almost double.  After a bit of thought, I realized I can explicitly build the string _and_ the range array, which cut down on both the run time and the memory, but only these numbers.

## Eureka!

After a couple days, I finally figured out that by storing each segment, the old way could re-use segments between pointers.

For example, let's combine `/foo/bar` and `/baz`.  The pointers for those hold the arrays `['foo', 'bar']` and `['baz']`.  When combining under the old way, I'd just merge the arrays: `['foo', 'bar', 'baz']`.  It's allocating a new array, but not new strings.  All of the segment strings stayed the same.

Under the new way, I'd actually build a new string `/foo/bar/baz` and then build a new array of `Range`s to point to the substrings.

So this new architecture isn't better after all.

## Deep in thought

I thought some more about the two approaches.  The old approach does pointer math really well, but I don't like that I have an object (`JsonPointer`) that contains more objects (`PointerSegment`) that each contain strings.  That seems wasteful.

Also, why did I make it a struct?  Structs should be a fixed size, and strings are never a fixed size (which is a major reason `string` is a class).  Secondly, the memory of a struct should also live on the stack, and strings and arrays (even arrays of structs) are stored on the heap; so really it's only the container that's on the stack.  A struct just isn't the right choice for this type, so change it back to a class.

What if the pointer just held the strings directly instead of having a secondary `PointerSegment` class?  Then all of the decoding/encoding logic would have to live somewhere else, but that's fine.  So I don't need a model for the segments; plain strings will do.

Lastly, I could make it implement `IReadOnlyList<string>`.  That would give users a `.Count` property, an indexer to access segments, and allow them to iterate over segments directly.

## A new implementation

Taking in all of this analysis, I updated `JsonPointer` again:

- It's a class again.
- It holds an array of (decoded) strings for the segments.
- It will cache its string representation.
  - Parsing a pointer already has the string; just store it.
  - Constructing a pointer and calling `.ToString()` builds on the fly and caches.

`PointerSegment`, which had also been changed to a struct in the first set of changes, remains a struct and acts as an intermediate type so that building pointers in code can mix strings and integer indices.  (See the `.Create()` method used in the code samples below.)  Keeping this as a struct means no allocations.

I fixed all of my tests and ran the benchmarks again:

| Parsing | Count | Mean        | Error     | StdDev    | Gen0     | Allocated |
|------- |------ |-----------:|----------:|----------:|---------:|----------:|
| 5.0.0 | 1     |   3.825 us | 0.0760 us | 0.0961 us |   3.0823 |    6.3 KB |
| 5.0.0 | 10    |  36.155 us | 0.6979 us | 0.9074 us |  30.8228 |  62.97 KB |
| 5.0.0 | 100   | 362.064 us | 6.7056 us | 6.2724 us | 308.1055 | 629.69 KB |

| Math | Count | Mean         | Error     | StdDev    | Gen0    | Allocated |
|------- |------ |------------:|----------:|----------:|--------:|----------:|
| 5.0.0 | 1     |    538.2 ns |  10.12 ns |  10.83 ns |  0.9794 |      2 KB |
| 5.0.0 | 10    |  5,188.1 ns |  97.80 ns | 104.65 ns |  9.7885 |     20 KB |
| 5.0.0 | 100   | 58,245.0 ns | 646.43 ns | 539.80 ns | 97.9004 |    200 KB |

For parsing, run time is a higher, generally about 30%, but allocations are down 26%.

For pointer math, run time and allocations are both down, about 20% and 15%, respectively.

I'm comfortable with the parsing time being a bit higher since I expect more usage of the pointer math.

## Some new toys

In addition to the simple indexer you get from `IReadOnlyList<string>`, if you're working in .Net 8, you also get a `Range` indexer which allows you to create a pointer using a subset of the segments.  This is really handy when you want to get the parent of a pointer

```c#
var pointer = JsonPointer.Create("foo", "bar", 5, "baz");
var parent = pointer[..^1];  // /foo/bar/5
```

or maybe the relative local pointer (i.e. the last segment)

```c#
var pointer = JsonPointer.Create("foo", "bar", 5, "baz");
var local = pointer[^1..];  // /baz
```

These operations are pretty common in _JsonSchema.Net_.

For those of you who haven't made it to .Net 8 just yet, this functionality is also available as methods:

```c#
var pointer = JsonPointer.Create("foo", "bar", 5, "baz");
var parent = pointer.GetAncestor(1);  // /foo/bar/5
var local = pointer.GetLocal(1);      // /baz
```

Personally, I like the indexer syntax.  I was concerned at first that having an indexer return a new object might feel unorthodox to some developers, but that's exactly what `string` is doing, so I'm fine with it.

## Wrap up

I like where this landed a lot more than where it was in the middle.  Something just felt off with the design, and I was having trouble isolating what the issue was.  I like that `PointerSegment` isn't part of the model anymore, and it's just "syntax candy" to help build pointers.  I really like the performance.

I learned a lot about memory management, which will be the subject of the next post.  But more than that, I learned that sometimes inaction is the right action.  I hesitated, and the library is better for it.
